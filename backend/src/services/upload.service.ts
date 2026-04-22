import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../config/env";
import { s3Client } from "../config/s3";
import { lectureAudioPartRepository } from "../repositories/lecture-audio-part.repository";
import { lectureRepository } from "../repositories/lecture.repository";
import { ApiError } from "../utils/api-error";

interface PresignInput {
  userId: string;
  lectureId: string;
  partNumber: number;
  contentType: string;
  sizeBytes: number;
}

interface CompletePartInput {
  userId: string;
  lectureId: string;
  partNumber: number;
  s3Key: string;
  contentType: string;
  sizeBytes: number;
  durationMs?: number;
}

export class UploadService {
  private assertAllowedContentType(contentType: string): void {
    const allowed = new Set([
      "audio/webm",
      "audio/ogg",
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/aac",
    ]);
    if (!allowed.has(contentType)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Unsupported content type for upload");
    }
  }

  private buildObjectKey(input: { userId: string; lectureId: string; partNumber: number; contentType: string }): string {
    this.assertAllowedContentType(input.contentType);
    const ext = (() => {
      switch (input.contentType) {
        case "audio/webm":
          return "webm";
        case "audio/ogg":
          return "ogg";
        case "audio/mpeg":
          return "mp3";
        case "audio/wav":
        case "audio/x-wav":
          return "wav";
        case "audio/mp4":
          return "m4a";
        case "audio/aac":
          return "aac";
        default:
          return "bin";
      }
    })();
    const padded = String(input.partNumber).padStart(5, "0");
    return `lectures/${input.userId}/${input.lectureId}/parts/${padded}.${ext}`;
  }

  private assertExpectedS3Key(input: CompletePartInput, expectedKey: string): void {
    if (input.s3Key !== expectedKey) {
      throw new ApiError(422, "VALIDATION_ERROR", "s3Key does not match presigned key for this part", {
        expectedKey,
      });
    }
  }

  async presignPart(input: PresignInput) {
    const lecture = await lectureRepository.findByIdForUser(input.lectureId, input.userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }
    this.assertAllowedContentType(input.contentType);
    if (input.sizeBytes > 250 * 1024 * 1024) {
      throw new ApiError(422, "VALIDATION_ERROR", "sizeBytes is too large for a single part");
    }

    const s3Key = this.buildObjectKey({
      userId: input.userId,
      lectureId: input.lectureId,
      partNumber: input.partNumber,
      contentType: input.contentType,
    });

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: s3Key,
      ContentType: input.contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS });
    return {
      uploadUrl,
      s3Key,
      s3Bucket: env.S3_BUCKET,
      expiresInSeconds: env.S3_PRESIGN_EXPIRES_SECONDS,
      requiredHeaders: {
        "content-type": input.contentType,
        "content-length": input.sizeBytes.toString(),
      },
    };
  }

  async completePart(input: CompletePartInput) {
    const lecture = await lectureRepository.findByIdForUser(input.lectureId, input.userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }
    this.assertAllowedContentType(input.contentType);
    if (input.sizeBytes > 250 * 1024 * 1024) {
      throw new ApiError(422, "VALIDATION_ERROR", "sizeBytes is too large for a single part");
    }

    const expectedKey = this.buildObjectKey({
      userId: input.userId,
      lectureId: input.lectureId,
      partNumber: input.partNumber,
      contentType: input.contentType,
    });
    this.assertExpectedS3Key(input, expectedKey);

    const expiresAt = new Date(Date.now() + env.AUDIO_PART_RETENTION_HOURS * 60 * 60 * 1000);

    await lectureAudioPartRepository.upsertPart({
      lectureId: input.lectureId,
      partNumber: input.partNumber,
      s3Bucket: env.S3_BUCKET,
      s3Key: input.s3Key,
      contentType: input.contentType,
      sizeBytes: BigInt(input.sizeBytes),
      durationMs: input.durationMs,
      expiresAt,
    });

    return { saved: true };
  }
}

export const uploadService = new UploadService();
