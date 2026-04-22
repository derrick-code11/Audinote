import type { Request, Response } from "express";

import { sendError } from "../utils/http-response";

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, {
    code: "NOT_FOUND",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}
