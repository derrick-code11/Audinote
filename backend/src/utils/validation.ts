import { z } from "zod";

import { ApiError } from "./api-error";

export function parseSchema<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Request validation failed", result.error.flatten());
  }
  return result.data;
}
