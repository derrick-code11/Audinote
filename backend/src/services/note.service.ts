import { lectureNoteRepository } from "../repositories/lecture-note.repository";
import { lectureRepository } from "../repositories/lecture.repository";
import { ApiError } from "../utils/api-error";

export class NoteService {
  async getLectureNotes(userId: string, lectureId: string) {
    const lecture = await lectureRepository.findByIdForUser(lectureId, userId);
    if (!lecture) {
      throw new ApiError(404, "NOT_FOUND", "Lecture not found");
    }

    const note = await lectureNoteRepository.findByLectureId(lectureId);
    if (!note || note.status !== "READY") {
      throw new ApiError(409, "NOT_READY", "Lecture notes are not ready");
    }

    return note;
  }
}

export const noteService = new NoteService();
