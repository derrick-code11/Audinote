import { env } from "./config/env";
import { log } from "./utils/logger";
import { startLectureWorker } from "./workers/lecture.worker";

if (!env.REDIS_URL) {
  console.error("Worker requires REDIS_URL");
  process.exit(1);
}

const worker = startLectureWorker();

log("info", "Lecture worker started", { queue: "lecture-processing" });

async function shutdown(signal: string): Promise<void> {
  log("info", "Lecture worker shutting down", { signal });
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
