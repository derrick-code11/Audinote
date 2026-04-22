import { Router } from "express";

import {
  completeUploadPart,
  createLecture,
  createLectureExport,
  deleteLecture,
  finalizeUpload,
  getLectureById,
  getLectureNotes,
  listLectureExports,
  listLectures,
  patchLecture,
  presignUploadPart,
  retryLecture,
} from "../controllers/lecture.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { asyncHandler } from "../utils/async-handler";

const lectureRouter = Router();

lectureRouter.use(requireAuth);

lectureRouter.post("/", asyncHandler(createLecture));
lectureRouter.get("/", asyncHandler(listLectures));
lectureRouter.patch("/:lectureId", asyncHandler(patchLecture));
lectureRouter.delete("/:lectureId", asyncHandler(deleteLecture));
lectureRouter.post("/:lectureId/retry", asyncHandler(retryLecture));
lectureRouter.get("/:lectureId", asyncHandler(getLectureById));
lectureRouter.post("/:lectureId/upload-parts/presign", asyncHandler(presignUploadPart));
lectureRouter.post("/:lectureId/upload-parts/complete", asyncHandler(completeUploadPart));
lectureRouter.post("/:lectureId/finalize-upload", asyncHandler(finalizeUpload));
lectureRouter.get("/:lectureId/notes", asyncHandler(getLectureNotes));
lectureRouter.post("/:lectureId/exports", asyncHandler(createLectureExport));
lectureRouter.get("/:lectureId/exports", asyncHandler(listLectureExports));

export { lectureRouter };
