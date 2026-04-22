import { prisma } from "../config/prisma";

export class LectureNoteRepository {
  findByLectureId(lectureId: string) {
    return prisma.lectureNote.findFirst({
      where: {
        lectureId,
        deletedAt: null,
      },
    });
  }
}

export const lectureNoteRepository = new LectureNoteRepository();
