import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../utils/api-error";
import { sendError } from "../utils/http-response";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof ApiError) {
    sendError(
      res,
      err.statusCode,
      {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      null,
    );
    return;
  }

  const fallbackMessage = err instanceof Error ? err.message : "Internal server error";
  sendError(
    res,
    500,
    {
      code: "INTERNAL_SERVER_ERROR",
      message: fallbackMessage,
    },
    null,
  );
}
