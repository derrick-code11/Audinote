import { Queue } from "bullmq";

import { log } from "../utils/logger";
import { createRedisConnection } from "./redis";

export const LECTURE_PROCESSING_QUEUE_NAME = "lecture-processing";

export const JOB_ORCHESTRATE = "orchestrate";
export const JOB_CHUNK = "chunk";
export const JOB_FINALIZE = "finalize";

let queue: Queue<{ lectureId: string; chunkId?: string }> | null = null;

export function getLectureProcessingQueue(): Queue<{
  lectureId: string;
  chunkId?: string;
}> {
  if (!queue) {
    queue = new Queue<{ lectureId: string; chunkId?: string }>(
      LECTURE_PROCESSING_QUEUE_NAME,
      {
        connection: createRedisConnection(),
      },
    );
  }
  return queue;
}

const defaultJobOpts = {
  removeOnComplete: { count: 5000 },
  removeOnFail: { count: 10_000 },
} as const;

function isDuplicateJobError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const msg = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return code === "EJOBEXISTS" || /already exists/i.test(msg);
}

export async function enqueueLectureProcessing(
  lectureId: string,
): Promise<void> {
  try {
    await getLectureProcessingQueue().add(
      JOB_ORCHESTRATE,
      { lectureId },
      {
        jobId: `orch-${lectureId}`,
        ...defaultJobOpts,
      },
    );
  } catch (err) {
    if (isDuplicateJobError(err)) {
      return;
    }
    log("error", "Failed to enqueue lecture orchestrate job", {
      lectureId,
      err: String(err),
    });
    throw err;
  }
}

export async function enqueueChunkProcessing(
  lectureId: string,
  chunkId: string,
): Promise<void> {
  try {
    await getLectureProcessingQueue().add(
      JOB_CHUNK,
      { lectureId, chunkId },
      {
        jobId: `${lectureId}-chunk-${chunkId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 4000 },
        ...defaultJobOpts,
      },
    );
  } catch (err) {
    if (isDuplicateJobError(err)) {
      return;
    }
    log("error", "Failed to enqueue lecture chunk job", {
      lectureId,
      chunkId,
      err: String(err),
    });
    throw err;
  }
}

export async function enqueueFinalizeProcessing(
  lectureId: string,
): Promise<void> {
  try {
    await getLectureProcessingQueue().add(
      JOB_FINALIZE,
      { lectureId },
      {
        jobId: `${lectureId}-finalize`,
        attempts: 3,
        backoff: { type: "exponential", delay: 8000 },
        ...defaultJobOpts,
      },
    );
  } catch (err) {
    if (isDuplicateJobError(err)) {
      return;
    }
    log("error", "Failed to enqueue lecture finalize job", {
      lectureId,
      err: String(err),
    });
    throw err;
  }
}
