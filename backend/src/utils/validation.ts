import { z } from "zod";

import { ApiError } from "./api-error";

export function parseSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Request validation failed", result.error.flatten());
  }
  return result.data;
}
