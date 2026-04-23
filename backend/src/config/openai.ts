import OpenAI from "openai";

import { env } from "./env";

const globalForOpenAI = globalThis as unknown as {
  openai?: OpenAI;
};

export function getOpenAIClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (!globalForOpenAI.openai) {
    globalForOpenAI.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return globalForOpenAI.openai;
}
