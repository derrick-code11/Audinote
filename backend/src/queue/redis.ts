import IORedis from "ioredis";

import { env } from "../config/env";

export function createRedisConnection(): IORedis {
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is not configured");
  }
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
