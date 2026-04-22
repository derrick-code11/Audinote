import type { Response } from "express";

import type { ApiErrorPayload, ApiResponse } from "../types/api-response";

export function sendOk<T>(res: Response, data: T, message: string | null = null): void {
  const payload: ApiResponse<T> = {
    data,
    error: null,
    message,
  };
  res.status(200).json(payload);
}

export function sendCreated<T>(res: Response, data: T, message: string | null = null): void {
  const payload: ApiResponse<T> = {
    data,
    error: null,
    message,
  };
  res.status(201).json(payload);
}

export function sendAccepted<T>(res: Response, data: T, message: string | null = null): void {
  const payload: ApiResponse<T> = {
    data,
    error: null,
    message,
  };
  res.status(202).json(payload);
}

export function sendError(
  res: Response,
  statusCode: number,
  error: ApiErrorPayload,
  message: string | null = null,
): void {
  const payload: ApiResponse<null> = {
    data: null,
    error,
    message,
  };
  res.status(statusCode).json(payload);
}
