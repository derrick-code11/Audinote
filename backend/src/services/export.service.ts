import type { ExportAction } from "@prisma/client";

import { googleDocExportRepository } from "../repositories/google-doc-export.repository";
import { lectureRepository } from "../repositories/lecture.repository";
import { ApiError } from "../utils/api-error";
import { log } from "../utils/logger";

export class ExportService {
  async triggerExport(userId: string, lectureId: string, action: ExportAction) {
    const lecture = await lectureRepository.findByIdForUser(lectureId, userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }

    const created = await googleDocExportRepository.createPending(lectureId, userId, action);
    log("info", "Lecture export triggered", { userId, lectureId, exportId: created.id, action });
    return {
      id: created.id,
      status: created.status,
      action: created.action,
      attemptedAt: created.attemptedAt,
    };
  }

  async listExports(userId: string, lectureId: string, limit: number, cursor?: string) {
    const lecture = await lectureRepository.findByIdForUser(lectureId, userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }

    const rawItems = await googleDocExportRepository.listForLecture(lectureId, userId, limit, cursor);
    const hasNext = rawItems.length > limit;
    const items = hasNext ? rawItems.slice(0, limit) : rawItems;
    const nextCursor = hasNext ? items.at(-1)?.id ?? null : null;

    const payload = {
      items,
      nextCursor,
    };
    log("info", "Lecture exports listed", { userId, lectureId, count: payload.items.length });
    return payload;
  }
}

export const exportService = new ExportService();
