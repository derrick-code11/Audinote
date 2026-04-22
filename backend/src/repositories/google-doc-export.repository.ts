import type { ExportAction } from "@prisma/client";

import { prisma } from "../config/prisma";

export class GoogleDocExportRepository {
  createPending(lectureId: string, userId: string, action: ExportAction) {
    return prisma.googleDocExport.create({
      data: {
        lectureId,
        userId,
        action,
        status: "PENDING",
      },
    });
  }

  async listForLecture(lectureId: string, userId: string, limit: number, cursor?: string) {
    return prisma.googleDocExport.findMany({
      where: {
        lectureId,
        userId,
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
    });
  }
}

export const googleDocExportRepository = new GoogleDocExportRepository();
