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

const MAX_UPLOAD_PART_SIZE_BYTES = 250 * 1024 * 1024;
const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/mp3": "mp3",
  "audio/aac": "aac",
};

export class UploadService {
  private assertAllowedContentType(contentType: string): void {
    if (!(contentType in CONTENT_TYPE_EXTENSIONS)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Unsupported content type for upload");
    }
  }

  private assertPartSizeWithinLimit(sizeBytes: number): void {
    if (sizeBytes > MAX_UPLOAD_PART_SIZE_BYTES) {
      throw new ApiError(422, "VALIDATION_ERROR", "sizeBytes is too large for a single part");
    }
  }

  private assertLectureExists(lecture: Awaited<ReturnType<typeof lectureRepository.findByIdForUser>>): void {
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }
  }

  private buildObjectKey(input: { userId: string; lectureId: string; partNumber: number; contentType: string }): string {
    this.assertAllowedContentType(input.contentType);
    const ext = CONTENT_TYPE_EXTENSIONS[input.contentType];
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
    this.assertLectureExists(lecture);
    this.assertAllowedContentType(input.contentType);
    this.assertPartSizeWithinLimit(input.sizeBytes);

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
    this.assertLectureExists(lecture);
    this.assertAllowedContentType(input.contentType);
    this.assertPartSizeWithinLimit(input.sizeBytes);

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
