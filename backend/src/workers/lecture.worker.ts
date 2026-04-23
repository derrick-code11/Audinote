import { Worker, type Job } from "bullmq";

import { createRedisConnection } from "../queue/redis";
import {
  JOB_CHUNK,
  JOB_FINALIZE,
  JOB_ORCHESTRATE,
  LECTURE_PROCESSING_QUEUE_NAME,
} from "../queue/lecture-processing.queue";
import { lecturePipelineService } from "../services/lecture-pipeline.service";
import { log } from "../utils/logger";

/** Long ASR/LLM runs: avoid BullMQ treating healthy jobs as stalled. */
const LOCK_MS = 30 * 60 * 1000;

type LectureJobData = { lectureId: string; chunkId?: string };

function resolveJobName(job: Job<LectureJobData>): string {
  const n = job.name;
  if (!n || n === "") {
    return JOB_ORCHESTRATE;
  }
  if (n === "process") {
    return JOB_ORCHESTRATE;
  }
  return n;
}

export function startLectureWorker(): Worker<LectureJobData> {
  const connection = createRedisConnection();

  const worker = new Worker<LectureJobData>(
    LECTURE_PROCESSING_QUEUE_NAME,
    async (job: Job<LectureJobData>) => {
      const name = resolveJobName(job);
      const { lectureId } = job.data;

      if (name === JOB_ORCHESTRATE) {
        log("info", "Lecture orchestrate job started", { lectureId, jobId: job.id });
        await lecturePipelineService.orchestrateLecture(lectureId);
        return;
      }

      if (name === JOB_CHUNK) {
        const chunkId = job.data.chunkId;
        if (!chunkId) {
          throw new Error("chunk job missing chunkId");
        }
        log("info", "Lecture chunk job started", { lectureId, chunkId, jobId: job.id });
        await lecturePipelineService.processChunk(lectureId, chunkId);
        return;
      }

      if (name === JOB_FINALIZE) {
        log("info", "Lecture finalize job started", { lectureId, jobId: job.id });
        await lecturePipelineService.finalizeLecture(lectureId);
        return;
      }

      log("warn", "Unknown lecture queue job name", { name, jobId: job.id });
    },
    {
      connection,
      concurrency: 8,
      lockDuration: LOCK_MS,
    },
  );

  worker.on("failed", (job, err) => {
    if (!job) {
      return;
    }
    const name = resolveJobName(job);
    if (name === JOB_CHUNK && job.data.chunkId) {
      void lecturePipelineService.onChunkJobPermanentlyFailed(job.data.lectureId, job.data.chunkId, String(err));
    }
    if (name === JOB_FINALIZE) {
      void lecturePipelineService.onFinalizeJobPermanentlyFailed(job.data.lectureId, String(err));
    }
    log("error", "Lecture processing job failed", {
      jobId: job.id,
      name,
      lectureId: job.data.lectureId,
      err: String(err),
    });
  });

  return worker;
}
