import { prisma } from "../config/prisma";
import { log } from "../utils/logger";

const PROCESSING = {
  run: "pipeline.run",
} as const;

export class LecturePipelineService {
  private inflight = new Set<string>();

  /**
   * MVP pipeline: creates a single chunk + mock transcript/extraction, composes a notes doc, and marks lecture DONE.
   * In production, replace the mocked steps with real ASR/LLM workers.
   */
  async processLecture(lectureId: string): Promise<void> {
    if (this.inflight.has(lectureId)) {
      return;
    }
    this.inflight.add(lectureId);
    try {
      await prisma.$transaction(async (tx) => {
        const lecture = await tx.lecture.findFirst({
          where: { id: lectureId, deletedAt: null },
        });
        if (!lecture) {
          return;
        }
        if (lecture.status !== "PROCESSING" && lecture.status !== "GENERATING") {
          return;
        }

        const existingReadyNote = await tx.lectureNote.findFirst({
          where: { lectureId, deletedAt: null, status: "READY" },
        });
        if (existingReadyNote) {
          await tx.lecture.update({
            where: { id: lectureId },
            data: { status: "DONE", processingCompletedAt: new Date() },
          });
          return;
        }

        // Idempotent reset: clear partial pipeline state before re-running.
        await tx.processingStepAttempt.deleteMany({ where: { lectureId } });
        await tx.chunkTranscript.deleteMany({ where: { chunk: { lectureId } } });
        await tx.chunkExtraction.deleteMany({ where: { chunk: { lectureId } } });
        await tx.lectureChunk.deleteMany({ where: { lectureId } });
        await tx.lectureNote.deleteMany({ where: { lectureId } });

        await tx.lecture.update({
          where: { id: lectureId },
          data: { status: "GENERATING" },
        });

        await tx.processingStepAttempt.create({
          data: {
            lectureId,
            chunkId: null,
            stepName: PROCESSING.run,
            attemptNumber: 1,
            status: "STARTED",
            startedAt: new Date(),
          },
        });

        const endMs = 1000;
        const chunk = await tx.lectureChunk.create({
          data: {
            lectureId,
            chunkIndex: 0,
            startMs: 0,
            endMs,
            durationMs: endMs,
            status: "PROCESSING",
            attemptCount: 1,
          },
        });

        await tx.processingStepAttempt.create({
          data: {
            lectureId,
            chunkId: chunk.id,
            stepName: "chunk.transcribe",
            attemptNumber: 1,
            status: "STARTED",
            startedAt: new Date(),
          },
        });

        const transcript = await tx.chunkTranscript.create({
          data: {
            chunkId: chunk.id,
            transcriptText: "MVP placeholder transcript. Replace with ASR output.",
          },
        });

        await tx.processingStepAttempt.updateMany({
          where: { lectureId, chunkId: chunk.id, stepName: "chunk.transcribe", attemptNumber: 1 },
          data: { status: "SUCCESS", finishedAt: new Date() },
        });

        const extraction = await tx.chunkExtraction.create({
          data: {
            chunkId: chunk.id,
            extractionJson: {
              summary: "MVP placeholder extraction. Replace with structured extraction model output.",
            },
          },
        });

        await tx.lectureChunk.update({
          where: { id: chunk.id },
          data: { status: "DONE" },
        });

        // Compose final notes
        const notesJson = {
          title: lecture.title ?? "Lecture notes",
          sections: [
            { heading: "Summary", body: (extraction.extractionJson as { summary?: string }).summary ?? "" },
            { heading: "Transcript", body: transcript.transcriptText },
          ],
        };

        await tx.lectureNote.upsert({
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

        await tx.lecture.update({
          where: { id: lectureId },
          data: { status: "DONE", processingCompletedAt: new Date(), errorMessage: null },
        });

        await tx.processingStepAttempt.updateMany({
          where: { lectureId, chunkId: null, stepName: PROCESSING.run, attemptNumber: 1 },
          data: { status: "SUCCESS", finishedAt: new Date() },
        });
      });

      log("info", "Lecture pipeline completed", { lectureId });
    } catch (error) {
      log("error", "Lecture pipeline failed", { lectureId, error: (error as Error).message });
      await prisma.lecture.updateMany({
        where: { id: lectureId, deletedAt: null },
        data: { status: "FAILED", errorMessage: (error as Error).message || "Pipeline failed" },
      });
    } finally {
      this.inflight.delete(lectureId);
    }
  }
}

export const lecturePipelineService = new LecturePipelineService();
