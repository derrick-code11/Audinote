import { prisma } from "../config/prisma";
import { googleDocExportWorker } from "../services/google-doc-export.worker";
import { lecturePipelineService } from "../services/lecture-pipeline.service";

const INTERVAL_MS = 3_000;

export function startBackgroundWorkers(): void {
  setInterval(() => {
    void tickPipeline();
  }, INTERVAL_MS);

  setInterval(() => {
    void googleDocExportWorker.tick();
  }, INTERVAL_MS);
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
    void lecturePipelineService.processLecture(row.id);
  }
}
