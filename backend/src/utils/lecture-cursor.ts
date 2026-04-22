import type { Lecture } from "@prisma/client";

import { ApiError } from "./api-error";

interface CursorPayloadV1 {
  v: 1;
  id: string;
  createdAt: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function encodeLectureCursor(lecture: Pick<Lecture, "id" | "createdAt">): string {
  const payload: CursorPayloadV1 = {
    v: 1,
    id: lecture.id,
    createdAt: lecture.createdAt.toISOString(),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLectureCursor(cursor: string): { id: string; createdAt: Date } {
  if (isUuid(cursor)) {
    return { id: cursor, createdAt: new Date(0) };
  }

  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<CursorPayloadV1>;
    if (parsed.v !== 1 || typeof parsed.id !== "string" || typeof parsed.createdAt !== "string") {
      throw new Error("Invalid cursor");
    }
    return { id: parsed.id, createdAt: new Date(parsed.createdAt) };
  } catch (error) {
    throw new ApiError(422, "VALIDATION_ERROR", "Invalid cursor", { details: (error as Error).message });
  }
}
