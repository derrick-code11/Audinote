import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../types/auth";
import { meService } from "../services/me.service";
import { sendAccepted, sendOk } from "../utils/http-response";
import { parseSchema } from "../utils/validation";

const patchMeBodySchema = z.object({
  exportPreference: z.enum(["auto", "manual"]),
});

const deleteMeBodySchema = z.object({
  confirm: z.literal("DELETE_MY_ACCOUNT"),
});

export async function getMe(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const userId = (req as AuthenticatedRequest).auth.userId;
  const data = await meService.getMe(userId);
  sendOk(res, data);
}

export async function patchMe(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const userId = (req as AuthenticatedRequest).auth.userId;
  const body = parseSchema(patchMeBodySchema, req.body);
  const data = await meService.updateMe(userId, body.exportPreference);
  sendOk(res, data);
}

export async function deleteMe(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const userId = (req as AuthenticatedRequest).auth.userId;
  parseSchema(deleteMeBodySchema, req.body);
  const data = await meService.deleteMe(userId);
  sendAccepted(res, data, "Account deletion accepted");
}
