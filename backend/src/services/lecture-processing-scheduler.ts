import { env } from "../config/env";
import { enqueueLectureProcessing } from "../queue/lecture-processing.queue";
import { log } from "../utils/logger";
import { lecturePipelineService } from "./lecture-pipeline.service";

/**
 * When REDIS_URL is set, schedules work on the BullMQ queue (worker service).
 * Otherwise runs the full pipeline in-process (local dev without Redis).
 */
export function scheduleLectureProcessing(lectureId: string): void {
  if (env.REDIS_URL) {
    void enqueueLectureProcessing(lectureId).catch((err) => {
      log("error", "Failed to enqueue lecture processing", { lectureId, err: String(err) });
    });
    return;
  }
  void lecturePipelineService.runFullPipelineInProcess(lectureId).catch((err) => {
    log("error", "In-process lecture pipeline failed", { lectureId, err: String(err) });
  });
}
