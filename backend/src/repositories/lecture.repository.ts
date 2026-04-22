import type { LectureSourceType, LectureStatus, Prisma } from "@prisma/client";

import { prisma } from "../config/prisma";
import { decodeLectureCursor } from "../utils/lecture-cursor";
import { ApiError } from "../utils/api-error";

interface ListLecturesInput {
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

export class LectureRepository {
  create(userId: string, title: string | null, sourceType: LectureSourceType) {
    return prisma.lecture.create({
      data: {
        userId,
        title,
        sourceType,
        status: "UPLOADING",
      },
    });
  }

  findByIdForUser(lectureId: string, userId: string) {
    return prisma.lecture.findFirst({
      where: {
        id: lectureId,
        userId,
        deletedAt: null,
      },
    });
  }

  async listForUser(input: ListLecturesInput) {
    const where: Prisma.LectureWhereInput = {
      userId: input.userId,
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.q ? { title: { contains: input.q, mode: "insensitive" } } : {}),
      ...(input.createdFrom || input.createdTo
        ? {
            createdAt: {
              ...(input.createdFrom ? { gte: input.createdFrom } : {}),
              ...(input.createdTo ? { lte: input.createdTo } : {}),
            },
          }
        : {}),
    };

    const orderBy: Prisma.LectureOrderByWithRelationInput[] = [
      { createdAt: input.sortOrder },
      { id: input.sortOrder },
    ];

    let cursorFilter: Prisma.LectureWhereInput | undefined;
    if (input.cursor) {
      const cursor = decodeLectureCursor(input.cursor);

      if (cursor.createdAt.getTime() === 0) {
        const last = await prisma.lecture.findFirst({
          where: {
            ...where,
            id: cursor.id,
          },
          select: { id: true, createdAt: true },
        });
        if (!last) {
          throw new ApiError(422, "VALIDATION_ERROR", "Invalid cursor");
        }
        cursor.createdAt = last.createdAt;
      }

      cursorFilter =
        input.sortOrder === "desc"
          ? {
              OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
            }
          : {
              OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
            };
    }

    const items = await prisma.lecture.findMany({
      where: cursorFilter ? { AND: [where, cursorFilter] } : where,
      take: input.limit + 1,
      orderBy,
    });

    return items;
  }

  updateForUser(lectureId: string, userId: string, data: Prisma.LectureUpdateInput) {
    return prisma.lecture.updateMany({
      where: {
        id: lectureId,
        userId,
        deletedAt: null,
      },
      data,
    });
  }
}

export const lectureRepository = new LectureRepository();
