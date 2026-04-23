import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { s3Client } from "../config/s3";
import { mergedAudioKey, segmentAudioKey } from "../utils/s3-lecture-audio";
import { log } from "../utils/logger";

async function deleteObjectQuiet(bucket: string, key: string): Promise<void> {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    /* missing key or transient errors — idempotent sweep */
  }
}

export class AudioRetentionService {
  /** Delete raw upload parts past `expiresAt` */
  async sweepExpiredAudioParts(): Promise<void> {
    const parts = await prisma.lectureAudioPart.findMany({
      where: { expiresAt: { lt: new Date() }, deletedFromStorageAt: null },
      take: 50,
    });
    for (const p of parts) {
      await deleteObjectQuiet(p.s3Bucket, p.s3Key);
      await prisma.lectureAudioPart.update({
        where: { id: p.id },
        data: { deletedFromStorageAt: new Date() },
      });
    }
    if (parts.length > 0) {
      log("info", "Expired audio parts purged from S3", { count: parts.length });
    }
  }

  async sweepDerivedLectureAudio(): Promise<void> {
    const hours = env.DERIVED_AUDIO_RETENTION_HOURS;
    if (hours <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const lectures = await prisma.lecture.findMany({
      where: {
        status: "DONE",
        deletedAt: null,
        derivedAudioDeletedAt: null,
        processingCompletedAt: { lt: cutoff },
      },
      select: { id: true, userId: true },
      take: 20,
    });
    for (const lec of lectures) {
      const chunkCount = await prisma.lectureChunk.count({ where: { lectureId: lec.id } });
      await deleteObjectQuiet(env.S3_BUCKET, mergedAudioKey(lec.userId, lec.id));
      for (let i = 0; i < chunkCount; i++) {
        await deleteObjectQuiet(env.S3_BUCKET, segmentAudioKey(lec.userId, lec.id, i));
      }
      await prisma.lecture.update({
        where: { id: lec.id },
        data: { derivedAudioDeletedAt: new Date() },
      });
    }
    if (lectures.length > 0) {
      log("info", "Derived lecture audio purged from S3", { lectureCount: lectures.length });
    }
  }
}

export const audioRetentionService = new AudioRetentionService();
