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

function getErrorField(err: object, field: "message" | "code"): string {
  if (!(field in err)) {
    return "";
  }
  return String((err as Record<"message" | "code", unknown>)[field] ?? "");
}

function isDuplicateJobError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const msg = getErrorField(err, "message");
  const code = getErrorField(err, "code");
  return code === "EJOBEXISTS" || /already exists/i.test(msg);
}

async function enqueueWithDuplicateGuard(
  params: {
    lectureId: string;
    chunkId?: string;
    jobName: typeof JOB_ORCHESTRATE | typeof JOB_CHUNK | typeof JOB_FINALIZE;
    data: { lectureId: string; chunkId?: string };
    options: {
      jobId: string;
      attempts?: number;
      backoff?: { type: "exponential"; delay: number };
      removeOnComplete?: { count: number };
      removeOnFail?: { count: number };
    };
    logMessage: string;
  }
): Promise<void> {
  const { lectureId, chunkId, jobName, data, options, logMessage } = params;

  try {
    await getLectureProcessingQueue().add(jobName, data, options);
  } catch (err) {
    if (isDuplicateJobError(err)) {
      return;
    }
    log("error", logMessage, {
      lectureId,
      ...(chunkId ? { chunkId } : {}),
      err: String(err),
    });
    throw err;
  }
}

export async function enqueueLectureProcessing(
  lectureId: string,
): Promise<void> {
  await enqueueWithDuplicateGuard({
    lectureId,
    jobName: JOB_ORCHESTRATE,
    data: { lectureId },
    options: {
      jobId: `orch-${lectureId}`,
      ...defaultJobOpts,
    },
    logMessage: "Failed to enqueue lecture orchestrate job",
  });
}

export async function enqueueChunkProcessing(
  lectureId: string,
  chunkId: string,
): Promise<void> {
  await enqueueWithDuplicateGuard({
    lectureId,
    chunkId,
    jobName: JOB_CHUNK,
    data: { lectureId, chunkId },
    options: {
      jobId: `${lectureId}-chunk-${chunkId}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 4000 },
      ...defaultJobOpts,
    },
    logMessage: "Failed to enqueue lecture chunk job",
  });
}

export async function enqueueFinalizeProcessing(
  lectureId: string,
): Promise<void> {
  await enqueueWithDuplicateGuard({
    lectureId,
    jobName: JOB_FINALIZE,
    data: { lectureId },
    options: {
      jobId: `${lectureId}-finalize`,
      attempts: 3,
      backoff: { type: "exponential", delay: 8000 },
      ...defaultJobOpts,
    },
    logMessage: "Failed to enqueue lecture finalize job",
  });
}
