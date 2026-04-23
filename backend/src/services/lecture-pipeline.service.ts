import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { s3Client } from "../config/s3";
import {
  enqueueChunkProcessing,
  enqueueFinalizeProcessing,
} from "../queue/lecture-processing.queue";
import { segmentAudioKey } from "../utils/s3-lecture-audio";
import { log } from "../utils/logger";

import {
  chunkExtractionSchema,
  mergeChunkTranscriptBodies,
  type ChunkExtractionJson,
  withVerbatimTranscriptSection,
} from "../types/lecture-notes";

import { audioAssemblyService } from "./audio-assembly.service";
import { lectureAiService } from "./lecture-ai.service";

const STEP = {
  orchestrate: "lecture.orchestrate",
  transcribe: "chunk.transcribe",
  extract: "chunk.extract",
  finalize: "lecture.finalize_notes",
} as const;

async function downloadSegmentToFile(bucket: string, key: string, destPath: string): Promise<void> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body || !(body instanceof Readable)) {
    throw new Error(`S3 segment has no readable body: ${key}`);
  }
  await pipeline(body, createWriteStream(destPath));
}

export class LecturePipelineService {
  async runFullPipelineInProcess(lectureId: string): Promise<void> {
    await this.orchestrateLecture(lectureId);
    const chunks = await prisma.lectureChunk.findMany({
      where: { lectureId },
      orderBy: { chunkIndex: "asc" },
      select: { id: true },
    });
    for (const c of chunks) {
      await this.processChunk(lectureId, c.id);
    }
    await this.finalizeLecture(lectureId);
  }

  async orchestrateLecture(lectureId: string): Promise<void> {
    const lecture = await prisma.lecture.findFirst({
      where: { id: lectureId, deletedAt: null },
    });
    if (!lecture) {
      return;
    }
    if (lecture.status !== "PROCESSING" && lecture.status !== "GENERATING") {
      return;
    }

    const existingReadyNote = await prisma.lectureNote.findFirst({
      where: { lectureId, deletedAt: null, status: "READY" },
    });
    if (existingReadyNote) {
      await prisma.lecture.update({
        where: { id: lectureId },
        data: { status: "DONE", processingCompletedAt: new Date(), errorMessage: null },
      });
      return;
    }

    const existingChunks = await prisma.lectureChunk.findMany({
      where: { lectureId },
      orderBy: { chunkIndex: "asc" },
    });

    if (existingChunks.length === 0) {
      const attempt = await prisma.processingStepAttempt.create({
        data: {
          lectureId,
          chunkId: null,
          stepName: STEP.orchestrate,
          attemptNumber: 1,
          status: "STARTED",
          startedAt: new Date(),
        },
      });
      try {
        await audioAssemblyService.mergeSplitAndPersistChunks(lectureId);
        await prisma.processingStepAttempt.update({
          where: { id: attempt.id },
          data: { status: "SUCCESS", finishedAt: new Date() },
        });
      } catch (error) {
        const msg = (error as Error).message || "Audio assembly failed";
        await prisma.processingStepAttempt.update({
          where: { id: attempt.id },
          data: { status: "FAILED", finishedAt: new Date(), errorMessage: msg },
        });
        await prisma.lecture.update({
          where: { id: lectureId },
          data: { status: "FAILED", errorMessage: msg },
        });
        log("error", "Orchestration failed", { lectureId, error: msg });
        return;
      }
    }

    const chunksToRun = await prisma.lectureChunk.findMany({
      where: {
        lectureId,
        OR: [
          { status: "PENDING" },
          {
            status: "PROCESSING",
            OR: [{ transcript: { is: null } }, { extraction: { is: null } }],
          },
        ],
      },
      orderBy: { chunkIndex: "asc" },
      select: { id: true },
    });

    if (env.REDIS_URL) {
      for (const c of chunksToRun) {
        await enqueueChunkProcessing(lectureId, c.id);
      }
    }

    log("info", "Lecture orchestration finished", {
      lectureId,
      enqueuedChunks: env.REDIS_URL ? chunksToRun.length : 0,
    });
  }

  async processChunk(lectureId: string, chunkId: string): Promise<void> {
    const chunk = await prisma.lectureChunk.findFirst({
      where: { id: chunkId, lectureId },
      include: {
        transcript: true,
        extraction: true,
        lecture: true,
      },
    });
    if (!chunk || chunk.lecture.deletedAt) {
      return;
    }
    if (chunk.lecture.status !== "PROCESSING" && chunk.lecture.status !== "GENERATING") {
      return;
    }

    if (chunk.status === "DONE" && chunk.transcript && chunk.extraction) {
      await this.maybeFinalizeAfterChunk(lectureId);
      return;
    }

    const userId = chunk.lecture.userId;
    const segKey = segmentAudioKey(userId, lectureId, chunk.chunkIndex);
    const workDir = path.join(tmpdir(), `audinote-chunk-${chunkId}-${Date.now()}`);
    await fs.mkdir(workDir, { recursive: true });
    const wavPath = path.join(workDir, "segment.wav");

    const nextAttempt = chunk.attemptCount + 1;
    await prisma.lectureChunk.update({
      where: { id: chunkId },
      data: { status: "PROCESSING", attemptCount: nextAttempt, lastErrorMessage: null },
    });

    if (!chunk.transcript) {
      const attemptT = await prisma.processingStepAttempt.create({
        data: {
          lectureId,
          chunkId,
          stepName: STEP.transcribe,
          attemptNumber: nextAttempt,
          status: "STARTED",
          startedAt: new Date(),
        },
      });
      try {
        await downloadSegmentToFile(env.S3_BUCKET, segKey, wavPath);
        if (!env.OPENAI_API_KEY) {
          throw new Error("OPENAI_API_KEY is not set");
        }
        const transcriptText = await lectureAiService.transcribeAudioFile(wavPath);
        await prisma.chunkTranscript.upsert({
          where: { chunkId },
          create: { chunkId, transcriptText },
          update: { transcriptText },
        });
        await prisma.processingStepAttempt.update({
          where: { id: attemptT.id },
          data: { status: "SUCCESS", finishedAt: new Date() },
        });
      } catch (error) {
        const msg = (error as Error).message || "Transcription failed";
        await prisma.processingStepAttempt.update({
          where: { id: attemptT.id },
          data: { status: "FAILED", finishedAt: new Date(), errorMessage: msg },
        });
        await prisma.lectureChunk.update({
          where: { id: chunkId },
          data: { lastErrorMessage: msg },
        });
        throw error;
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } else {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const transcriptRow = await prisma.chunkTranscript.findUniqueOrThrow({ where: { chunkId } });

    if (!chunk.extraction) {
      const attemptE = await prisma.processingStepAttempt.create({
        data: {
          lectureId,
          chunkId,
          stepName: STEP.extract,
          attemptNumber: nextAttempt,
          status: "STARTED",
          startedAt: new Date(),
        },
      });
      try {
        const extractionJson = await lectureAiService.extractFromChunkTranscript(transcriptRow.transcriptText);
        await prisma.chunkExtraction.upsert({
          where: { chunkId },
          create: { chunkId, extractionJson },
          update: { extractionJson },
        });
        await prisma.processingStepAttempt.update({
          where: { id: attemptE.id },
          data: { status: "SUCCESS", finishedAt: new Date() },
        });
      } catch (error) {
        const msg = (error as Error).message || "Extraction failed";
        await prisma.processingStepAttempt.update({
          where: { id: attemptE.id },
          data: { status: "FAILED", finishedAt: new Date(), errorMessage: msg },
        });
        await prisma.lectureChunk.update({
          where: { id: chunkId },
          data: { lastErrorMessage: msg },
        });
        throw error;
      }
    }

    await prisma.lectureChunk.update({
      where: { id: chunkId },
      data: { status: "DONE", lastErrorMessage: null },
    });

    log("info", "Chunk processed", { lectureId, chunkId, chunkIndex: chunk.chunkIndex });
    await this.maybeFinalizeAfterChunk(lectureId);
  }

  private async maybeFinalizeAfterChunk(lectureId: string): Promise<void> {
    const failed = await prisma.lectureChunk.count({
      where: { lectureId, status: "FAILED" },
    });
    if (failed > 0) {
      return;
    }
    const pending = await prisma.lectureChunk.count({
      where: { lectureId, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (pending > 0) {
      return;
    }
    const done = await prisma.lectureChunk.count({
      where: { lectureId, status: "DONE" },
    });
    if (done === 0) {
      return;
    }

    if (env.REDIS_URL) {
      await enqueueFinalizeProcessing(lectureId);
    } else {
      await this.finalizeLecture(lectureId);
    }
  }

  async finalizeLecture(lectureId: string): Promise<void> {
    const lecture = await prisma.lecture.findFirst({
      where: { id: lectureId, deletedAt: null },
    });
    if (!lecture) {
      return;
    }

    const existingReadyNote = await prisma.lectureNote.findFirst({
      where: { lectureId, deletedAt: null, status: "READY" },
    });
    if (existingReadyNote) {
      await prisma.lecture.update({
        where: { id: lectureId },
        data: { status: "DONE", processingCompletedAt: new Date(), errorMessage: null },
      });
      return;
    }

    const gate = await prisma.$transaction(async (tx) => {
      const lec = await tx.lecture.findFirst({ where: { id: lectureId, deletedAt: null } });
      if (!lec || lec.status === "DONE") {
        return { action: "already" as const };
      }

      const readyNote = await tx.lectureNote.findFirst({
        where: { lectureId, deletedAt: null, status: "READY" },
      });
      if (readyNote) {
        await tx.lecture.update({
          where: { id: lectureId },
          data: { status: "DONE", processingCompletedAt: new Date(), errorMessage: null },
        });
        return { action: "already" as const };
      }

      const failedChunks = await tx.lectureChunk.count({
        where: { lectureId, status: "FAILED" },
      });
      if (failedChunks > 0) {
        return { action: "fail" as const, reason: "One or more chunks failed" };
      }
      const notDone = await tx.lectureChunk.count({
        where: { lectureId, NOT: { status: "DONE" } },
      });
      if (notDone > 0) {
        return { action: "wait" as const };
      }

      if (lec.status === "PROCESSING") {
        await tx.lecture.update({
          where: { id: lectureId },
          data: { status: "GENERATING" },
        });
      } else if (lec.status !== "GENERATING") {
        return { action: "wait" as const };
      }
      return { action: "proceed" as const };
    });

    if (gate.action === "already") {
      return;
    }
    if (gate.action === "fail") {
      await prisma.lecture.updateMany({
        where: { id: lectureId, deletedAt: null },
        data: { status: "FAILED", errorMessage: gate.reason },
      });
      return;
    }
    if (gate.action !== "proceed") {
      return;
    }

    const attempt = await prisma.processingStepAttempt.create({
      data: {
        lectureId,
        chunkId: null,
        stepName: STEP.finalize,
        attemptNumber: 1,
        status: "STARTED",
        startedAt: new Date(),
      },
    });

    try {
      const chunks = await prisma.lectureChunk.findMany({
        where: { lectureId, status: "DONE" },
        orderBy: { chunkIndex: "asc" },
        include: { transcript: true, extraction: true },
      });
      if (chunks.length === 0) {
        throw new Error("No completed audio chunks to synthesize notes from");
      }
      const chunkTranscripts = chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        text: c.transcript?.transcriptText ?? "",
      }));
      const chunkExtractions: { chunkIndex: number; data: ChunkExtractionJson }[] = [];
      for (const c of chunks) {
        const parsed = chunkExtractionSchema.safeParse(c.extraction?.extractionJson);
        if (!parsed.success) {
          throw new Error(`Invalid extraction JSON for chunk index ${c.chunkIndex}`);
        }
        chunkExtractions.push({ chunkIndex: c.chunkIndex, data: parsed.data });
      }

      const composed = await lectureAiService.composeFinalNotes({
        lectureTitle: lecture.title,
        chunkTranscripts,
        chunkExtractions,
      });
      const verbatimTranscript = mergeChunkTranscriptBodies(chunkTranscripts);
      const notesJson = withVerbatimTranscriptSection(composed, verbatimTranscript);

      await prisma.lectureNote.upsert({
        where: { lectureId },
        update: {
          notesJson,
          status: "READY",
          errorMessage: null,
          generatedAt: new Date(),
          deletedAt: null,
        },
        create: {
          lectureId,
          notesJson,
          status: "READY",
          generatedAt: new Date(),
        },
      });

      await prisma.lecture.update({
        where: { id: lectureId },
        data: { status: "DONE", processingCompletedAt: new Date(), errorMessage: null },
      });

      await prisma.processingStepAttempt.update({
        where: { id: attempt.id },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
      log("info", "Lecture finalized", { lectureId });
    } catch (error) {
      const msg = (error as Error).message || "Finalize failed";
      await prisma.processingStepAttempt.update({
        where: { id: attempt.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: msg },
      });
      await prisma.lecture.update({
        where: { id: lectureId },
        data: { status: "FAILED", errorMessage: msg },
      });
      log("error", "Finalize failed", { lectureId, error: msg });
    }
  }

  async onChunkJobPermanentlyFailed(lectureId: string, chunkId: string, err: string): Promise<void> {
    const current = await prisma.lectureChunk.findFirst({ where: { id: chunkId, lectureId } });
    if (!current || current.status === "DONE") {
      return;
    }
    await prisma.lectureChunk.updateMany({
      where: { id: chunkId, lectureId },
      data: { status: "FAILED", lastErrorMessage: err },
    });
    await prisma.lecture.updateMany({
      where: { id: lectureId, deletedAt: null },
      data: { status: "FAILED", errorMessage: err || "Chunk processing failed" },
    });
    log("error", "Chunk job permanently failed", { lectureId, chunkId, err });
  }

  async onFinalizeJobPermanentlyFailed(lectureId: string, err: string): Promise<void> {
    const lec = await prisma.lecture.findFirst({ where: { id: lectureId, deletedAt: null } });
    if (!lec || lec.status === "DONE") {
      return;
    }
    await prisma.lecture.updateMany({
      where: { id: lectureId, deletedAt: null },
      data: { status: "FAILED", errorMessage: err || "Finalize failed" },
    });
    log("error", "Finalize job permanently failed", { lectureId, err });
  }
}

export const lecturePipelineService = new LecturePipelineService();
