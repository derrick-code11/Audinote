import type { Request, Response } from "express";
import { z } from "zod";

import { authService } from "../services/auth.service";
import type { AuthenticatedRequest } from "../types/auth";
import { sendOk } from "../utils/http-response";
import { parseSchema } from "../utils/validation";

const googleCallbackQuerySchema = z.object({
  code: z.string().min(1),
});

export async function getGoogleStart(_req: Request, res: Response): Promise<void> {
  const url = authService.getGoogleStartUrl();
  sendOk(res, { url });
}

export async function getGoogleCallback(req: Request, res: Response): Promise<void> {
  const { code } = parseSchema(googleCallbackQuerySchema, req.query);
  const session = await authService.authenticateWithGoogleCode(code);
  sendOk(res, {
    token: session.token,
    userId: session.userId,
  });
}

export async function postLogout(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthenticatedRequest).auth.userId;
  await authService.logoutUser(userId);
  sendOk(res, { loggedOut: true });
}
