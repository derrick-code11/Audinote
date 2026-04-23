import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { s3Client } from "../config/s3";
import { mergedAudioKey, segmentAudioKey } from "../utils/s3-lecture-audio";
import { log } from "../utils/logger";

const execFileAsync = promisify(execFile);

async function assertFfmpegAvailable(): Promise<void> {
  await execFileAsync("ffmpeg", ["-version"]);
}

async function downloadObjectToFile(bucket: string, key: string, destPath: string): Promise<void> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body || !(body instanceof Readable)) {
    throw new Error(`S3 object has no readable body: ${key}`);
  }
  await pipeline(body, createWriteStream(destPath));
}

async function uploadFileToS3(localPath: string, bucket: string, key: string, contentType: string): Promise<void> {
  const buf = await fs.readFile(localPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }),
  );
}

async function probeDurationMs(wavPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    wavPath,
  ]);
  const sec = parseFloat(String(stdout).trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new Error("ffprobe returned invalid duration");
  }
  return Math.round(sec * 1000);
}

export class AudioAssemblyService {
  /**
   * Downloads parts, normalizes to 16 kHz mono PCM WAV, concatenates, uploads merged WAV,
   * splits into segment WAVs (~LECTURE_CHUNK_DURATION_MS), uploads segments, creates `LectureChunk` rows.
   */
  async mergeSplitAndPersistChunks(lectureId: string): Promise<void> {
    await assertFfmpegAvailable();

    const lecture = await prisma.lecture.findFirst({
      where: { id: lectureId, deletedAt: null },
      include: {
        audioParts: { orderBy: { partNumber: "asc" } },
      },
    });
    if (!lecture) {
      throw new Error("Lecture not found");
    }
    if (lecture.audioParts.length === 0) {
      throw new Error("No audio parts uploaded for this lecture");
    }

    const workDir = path.join(tmpdir(), `audinote-audio-${lectureId}-${Date.now()}`);
    await fs.mkdir(workDir, { recursive: true });

    const normalizedNames: string[] = [];
    try {
      for (let i = 0; i < lecture.audioParts.length; i++) {
        const part = lecture.audioParts[i]!;
        const srcName = `raw-${i}`;
        const srcPath = path.join(workDir, srcName);
        const normName = `part-${i}.wav`;
        const normPath = path.join(workDir, normName);
        await downloadObjectToFile(part.s3Bucket, part.s3Key, srcPath);
        await execFileAsync(
          "ffmpeg",
          ["-y", "-i", srcPath, "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", normPath],
          { cwd: workDir },
        );
        normalizedNames.push(normName);
        await fs.unlink(srcPath).catch(() => undefined);
      }

      const concatListPath = path.join(workDir, "concat.txt");
      const concatLines = normalizedNames.map((n) => `file '${n}'`).join("\n");
      await fs.writeFile(concatListPath, concatLines, "utf8");

      const mergedName = "merged.wav";
      const mergedLocal = path.join(workDir, mergedName);
      await execFileAsync(
        "ffmpeg",
        ["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:a", "pcm_s16le", mergedName],
        { cwd: workDir },
      );

      const durationMs = await probeDurationMs(mergedLocal);
      const mergedKey = mergedAudioKey(lecture.userId, lectureId);
      await uploadFileToS3(mergedLocal, env.S3_BUCKET, mergedKey, "audio/wav");

      const chunkWindowMs = env.LECTURE_CHUNK_DURATION_MS;
      const windows: { startMs: number; endMs: number; durationMs: number }[] = [];
      for (let startMs = 0; startMs < durationMs; startMs += chunkWindowMs) {
        const endMs = Math.min(startMs + chunkWindowMs, durationMs);
        if (endMs <= startMs) break;
        windows.push({ startMs, endMs, durationMs: endMs - startMs });
      }
      if (windows.length === 0) {
        throw new Error("Computed zero audio chunks");
      }

      for (let i = 0; i < windows.length; i++) {
        const w = windows[i]!;
        const segName = `segment-${i}.wav`;
        const segLocal = path.join(workDir, segName);
        const startSec = w.startMs / 1000;
        const durSec = w.durationMs / 1000;
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            mergedName,
            "-ss",
            String(startSec),
            "-t",
            String(durSec),
            "-c:a",
            "pcm_s16le",
            segName,
          ],
          { cwd: workDir },
        );
        const segKey = segmentAudioKey(lecture.userId, lectureId, i);
        await uploadFileToS3(segLocal, env.S3_BUCKET, segKey, "audio/wav");
      }

      await prisma.$transaction(async (tx) => {
        await tx.lectureChunk.deleteMany({ where: { lectureId } });
        await tx.lecture.update({
          where: { id: lectureId },
          data: { durationSeconds: Math.max(1, Math.round(durationMs / 1000)) },
        });
        await tx.lectureChunk.createMany({
          data: windows.map((w, i) => ({
            lectureId,
            chunkIndex: i,
            startMs: w.startMs,
            endMs: w.endMs,
            durationMs: w.durationMs,
            status: "PENDING" as const,
            attemptCount: 0,
          })),
        });
      });

      log("info", "Audio merge/split complete", { lectureId, chunkCount: windows.length, durationMs });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export const audioAssemblyService = new AudioAssemblyService();
