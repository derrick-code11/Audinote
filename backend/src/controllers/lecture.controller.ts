import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { ExportAction, LectureSourceType, LectureStatus } from "@prisma/client";

import { exportService } from "../services/export.service";
import { lectureService } from "../services/lecture.service";
import { noteService } from "../services/note.service";
import { uploadService } from "../services/upload.service";
import type { AuthenticatedRequest } from "../types/auth";
import { sendAccepted, sendCreated, sendOk } from "../utils/http-response";
import { parseSchema } from "../utils/validation";

const lectureIdParamSchema = z.object({
  lectureId: z.string().uuid(),
});

const createLectureBodySchema = z.object({
  sourceType: z.enum(["live_recording", "file_upload"]),
  title: z.string().min(1).max(255).optional(),
});

const listLecturesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  sortBy: z.enum(["createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["uploading", "processing", "generating", "done", "failed"]).optional(),
  sourceType: z.enum(["live_recording", "file_upload"]).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  q: z.string().min(1).optional(),
});

const presignPartBodySchema = z.object({
  partNumber: z.coerce.number().int().min(0),
  contentType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive(),
});

const completePartBodySchema = z.object({
  partNumber: z.coerce.number().int().min(0),
  s3Key: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive(),
  durationMs: z.coerce.number().int().min(0).optional(),
});

const finalizeUploadBodySchema = z.object({
  durationSeconds: z.coerce.number().int().min(0).optional(),
});

const createExportBodySchema = z.object({
  action: z.enum(["create", "update", "recreate"]),
});

const listExportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

const patchLectureBodySchema = z.object({
  title: z.string().min(1).max(255),
});

function getAuthUserId(req: Request): string {
  return (req as AuthenticatedRequest).auth.userId;
}

function mapSourceType(input: "live_recording" | "file_upload"): LectureSourceType {
  return input === "live_recording" ? "LIVE_RECORDING" : "FILE_UPLOAD";
}

function mapLectureStatus(input: "uploading" | "processing" | "generating" | "done" | "failed"): LectureStatus {
  switch (input) {
    case "uploading":
      return "UPLOADING";
    case "processing":
      return "PROCESSING";
    case "generating":
      return "GENERATING";
    case "done":
      return "DONE";
    case "failed":
      return "FAILED";
  }
}

function mapExportAction(input: "create" | "update" | "recreate"): ExportAction {
  switch (input) {
    case "create":
      return "CREATE";
    case "update":
      return "UPDATE";
    case "recreate":
      return "RECREATE";
  }
}

export async function createLecture(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const body = parseSchema(createLectureBodySchema, req.body);

  const data = await lectureService.createLecture(userId, mapSourceType(body.sourceType), body.title);
  sendCreated(res, data);
}

export async function listLectures(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const query = parseSchema(listLecturesQuerySchema, req.query);

  const data = await lectureService.listLectures({
    userId,
    limit: query.limit ?? 20,
    cursor: query.cursor,
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    status: query.status ? mapLectureStatus(query.status) : undefined,
    sourceType: query.sourceType ? mapSourceType(query.sourceType) : undefined,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    q: query.q,
  });
  sendOk(res, data);
}

export async function getLectureById(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const data = await lectureService.getLectureById(userId, params.lectureId);
  sendOk(res, data);
}

export async function patchLecture(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const body = parseSchema(patchLectureBodySchema, req.body);
  const data = await lectureService.updateLectureTitle(userId, params.lectureId, body.title);
  sendOk(res, data);
}

export async function deleteLecture(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const data = await lectureService.softDeleteLecture(userId, params.lectureId);
  sendOk(res, data);
}

export async function retryLecture(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const data = await lectureService.retryLecture(userId, params.lectureId);
  sendAccepted(res, data);
}

export async function presignUploadPart(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const body = parseSchema(presignPartBodySchema, req.body);
  const data = await uploadService.presignPart({
    userId,
    lectureId: params.lectureId,
    partNumber: body.partNumber,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
  });
  sendOk(res, data);
}

export async function completeUploadPart(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const body = parseSchema(completePartBodySchema, req.body);
  const data = await uploadService.completePart({
    userId,
    lectureId: params.lectureId,
    partNumber: body.partNumber,
    s3Key: body.s3Key,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
    durationMs: body.durationMs,
  });
  sendOk(res, data);
}

export async function finalizeUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const body = parseSchema(finalizeUploadBodySchema, req.body ?? {});
  const data = await lectureService.finalizeUpload(userId, params.lectureId, body.durationSeconds);
  sendAccepted(res, data);
}

export async function getLectureNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const data = await noteService.getLectureNotes(userId, params.lectureId);
  sendOk(res, data);
}

export async function createLectureExport(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const body = parseSchema(createExportBodySchema, req.body);
  const data = await exportService.triggerExport(userId, params.lectureId, mapExportAction(body.action));
  sendAccepted(res, data);
}

export async function listLectureExports(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuthUserId(req);
  const params = parseSchema(lectureIdParamSchema, req.params);
  const query = parseSchema(listExportsQuerySchema, req.query);
  const data = await exportService.listExports(
    userId,
    params.lectureId,
    query.limit ?? 20,
    query.cursor,
  );
  sendOk(res, data);
}
