import { prisma } from "../config/prisma";

interface CompleteAudioPartInput {
  lectureId: string;
  partNumber: number;
  s3Bucket: string;
  s3Key: string;
  contentType: string;
  sizeBytes: bigint;
  durationMs?: number;
  expiresAt: Date;
}

export class LectureAudioPartRepository {
  upsertPart(input: CompleteAudioPartInput) {
    return prisma.lectureAudioPart.upsert({
      where: {
        lectureId_partNumber: {
          lectureId: input.lectureId,
          partNumber: input.partNumber,
        },
      },
      create: input,
      update: {
        s3Bucket: input.s3Bucket,
        s3Key: input.s3Key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        durationMs: input.durationMs,
        expiresAt: input.expiresAt,
        uploadedAt: new Date(),
      },
    });
  }
}

export const lectureAudioPartRepository = new LectureAudioPartRepository();
