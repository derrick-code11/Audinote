import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { enqueueLectureProcessing } from "../queue/lecture-processing.queue";
import { audioRetentionService } from "../services/audio-retention.service";
import { googleDocExportWorker } from "../services/google-doc-export.worker";
import { lecturePipelineService } from "../services/lecture-pipeline.service";
import { log } from "../utils/logger";

const INTERVAL_MS = 3000;
const RETENTION_SWEEP_MS = 60 * 60 * 1000;

export function startBackgroundWorkers(): void {
  void tickRetention();

  setInterval(() => {
    void tickPipeline();
  }, INTERVAL_MS);

  setInterval(() => {
    void googleDocExportWorker.tick();
  }, INTERVAL_MS);

  setInterval(() => {
    void tickRetention();
  }, RETENTION_SWEEP_MS);
}

async function tickPipeline(): Promise<void> {
  const stuck = await prisma.lecture.findMany({
    where: {
      deletedAt: null,
      status: { in: ["PROCESSING", "GENERATING"] },
    },
    orderBy: { updatedAt: "asc" },
    take: 5,
    select: { id: true },
  });

  for (const row of stuck) {
    if (env.REDIS_URL) {
      try {
        await enqueueLectureProcessing(row.id);
      } catch (err) {
        log("error", "Failed to enqueue stuck lecture from tick", {
          lectureId: row.id,
          err: String(err),
        });
      }
    } else {
      void lecturePipelineService.runFullPipelineInProcess(row.id).catch((err) => {
        log("error", "In-process pipeline tick failed", { lectureId: row.id, err: String(err) });
      });
    }
  }
}

async function tickRetention(): Promise<void> {
  try {
    await audioRetentionService.sweepExpiredAudioParts();
    await audioRetentionService.sweepDerivedLectureAudio();
  } catch (err) {
    log("error", "Audio retention sweep failed", { err: String(err) });
  }
}
