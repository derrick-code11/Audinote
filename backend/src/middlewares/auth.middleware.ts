import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { authService } from "../services/auth.service";
import type { AuthenticatedRequest } from "../types/auth";
import { ApiError } from "../utils/api-error";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const bypassUserId = env.AUTH_BYPASS_USER_ID;
  if (bypassUserId) {
    (req as AuthenticatedRequest).auth = { userId: bypassUserId };
    next();
    return;
  }

  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing bearer token"));
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing bearer token"));
    return;
  }

  const payload = authService.verifyJwt(token);
  (req as AuthenticatedRequest).auth = { userId: payload.sub };
  next();
}
