import type { NextFunction, Request, Response } from "express";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const errorMessage = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({
    success: false,
    error: errorMessage,
  });
}
