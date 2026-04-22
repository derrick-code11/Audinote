import type { LectureSourceType, LectureStatus } from "@prisma/client";

import { lectureRepository } from "../repositories/lecture.repository";
import { ApiError } from "../utils/api-error";
import { encodeLectureCursor } from "../utils/lecture-cursor";
import { log } from "../utils/logger";
import { lecturePipelineService } from "./lecture-pipeline.service";
import { prisma } from "../config/prisma";

interface ListLectureParams {
  userId: string;
  limit: number;
  cursor?: string;
  sortBy: "createdAt";
  sortOrder: "asc" | "desc";
  status?: LectureStatus;
  sourceType?: LectureSourceType;
  createdFrom?: Date;
  createdTo?: Date;
  q?: string;
}

export class LectureService {
  async createLecture(userId: string, sourceType: LectureSourceType, title?: string) {
    const lecture = await lectureRepository.create(userId, title ?? null, sourceType);
    log("info", "Lecture created", { userId, lectureId: lecture.id, sourceType });
    return lecture;
  }

  async getLectureById(userId: string, lectureId: string) {
    const lecture = await lectureRepository.findByIdForUser(lectureId, userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }

    return {
      ...lecture,
      progressPercent: this.getProgressPercent(lecture.status),
      currentStep: this.getCurrentStep(lecture.status),
    };
  }

  async listLectures(params: ListLectureParams) {
    const rawItems = await lectureRepository.listForUser(params);
    const hasNext = rawItems.length > params.limit;
    const items = hasNext ? rawItems.slice(0, params.limit) : rawItems;
    const last = items.at(-1);
    const nextCursor = hasNext && last ? encodeLectureCursor(last) : null;

    const payload = {
      items: items.map((item) => ({
        ...item,
        progressPercent: this.getProgressPercent(item.status),
        currentStep: this.getCurrentStep(item.status),
      })),
      nextCursor,
    };
    log("info", "Lectures listed", { userId: params.userId, count: payload.items.length });
    return payload;
  }

  async updateLectureTitle(userId: string, lectureId: string, title: string) {
    const result = await lectureRepository.updateForUser(lectureId, userId, { title });
    if (result.count === 0) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }
    return this.getLectureById(userId, lectureId);
  }

  async softDeleteLecture(userId: string, lectureId: string) {
    const result = await lectureRepository.updateForUser(lectureId, userId, {
      deletedAt: new Date(),
    });
    if (result.count === 0) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }
    return { deleted: true };
  }

  async retryLecture(userId: string, lectureId: string) {
    const lecture = await lectureRepository.findByIdForUser(lectureId, userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }

    if (lecture.status !== "FAILED") {
      throw new ApiError(409, "CONFLICT", "Lecture is not in a failed state");
    }

    await prisma.$transaction(async (tx) => {
      await tx.lecture.updateMany({
        where: { id: lectureId, userId, deletedAt: null },
        data: {
          status: "PROCESSING",
          errorMessage: null,
          processingStartedAt: new Date(),
          processingCompletedAt: null,
        },
      });

      await tx.processingStepAttempt.deleteMany({ where: { lectureId } });
      await tx.chunkTranscript.deleteMany({ where: { chunk: { lectureId } } });
      await tx.chunkExtraction.deleteMany({ where: { chunk: { lectureId } } });
      await tx.lectureChunk.deleteMany({ where: { lectureId } });
      await tx.lectureNote.deleteMany({ where: { lectureId } });
    });

    void lecturePipelineService.processLecture(lectureId);
    return { accepted: true };
  }

  async finalizeUpload(userId: string, lectureId: string, durationSeconds?: number) {
    const lecture = await lectureRepository.findByIdForUser(lectureId, userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }

    if (lecture.status !== "UPLOADING") {
      throw new ApiError(409, "ALREADY_FINALIZED", "Lecture upload has already been finalized");
    }

    await lectureRepository.updateForUser(lectureId, userId, {
      status: "PROCESSING",
      processingStartedAt: new Date(),
      durationSeconds: durationSeconds ?? lecture.durationSeconds,
    });

    log("info", "Lecture upload finalized", { userId, lectureId });
    void lecturePipelineService.processLecture(lectureId);
    return { accepted: true };
  }

  private getProgressPercent(status: LectureStatus): number {
    switch (status) {
      case "UPLOADING":
        return 10;
      case "PROCESSING":
        return 50;
      case "GENERATING":
        return 80;
      case "DONE":
        return 100;
      case "FAILED":
        return 100;
      default:
        return 0;
    }
  }

  private getCurrentStep(status: LectureStatus): string {
    switch (status) {
      case "UPLOADING":
        return "uploading";
      case "PROCESSING":
        return "processing_audio";
      case "GENERATING":
        return "generating_notes";
      case "DONE":
        return "completed";
      case "FAILED":
        return "failed";
      default:
        return "unknown";
    }
  }
}

export const lectureService = new LectureService();
