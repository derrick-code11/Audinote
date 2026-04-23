import { zodResponseFormat } from "openai/helpers/zod";

import { env } from "../config/env";
import { getOpenAIClient } from "../config/openai";
import {
  chunkExtractionSchema,
  lectureNotesJsonSchema,
  type ChunkExtractionJson,
  type LectureNotesJson,
} from "../types/lecture-notes";
import { log } from "../utils/logger";

export class LectureAiService {
  async transcribeAudioFile(localPath: string): Promise<string> {
    const client = getOpenAIClient();
    const file = await import("node:fs").then((fs) =>
      fs.createReadStream(localPath),
    );
    const res = await client.audio.transcriptions.create({
      file,
      model: env.OPENAI_TRANSCRIPTION_MODEL,
    });
    return res.text ?? "";
  }

  async extractFromChunkTranscript(
    transcript: string,
  ): Promise<ChunkExtractionJson> {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.parse({
      model: env.OPENAI_STRUCTURED_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You extract structured study notes from a single lecture transcript segment. Use ONLY information explicitly present in the transcript. Do not invent facts, citations, or examples. If a field has nothing supported by the text, use an empty array. Output must match the JSON schema.",
        },
        {
          role: "user",
          content: `Transcript:\n\n${transcript}`,
        },
      ],
      response_format: zodResponseFormat(
        chunkExtractionSchema,
        "chunk_extraction",
      ),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      const refusal = completion.choices[0]?.message.refusal;
      throw new Error(refusal ?? "Chunk extraction returned no parsed content");
    }
    return parsed;
  }

  async composeFinalNotes(input: {
    lectureTitle: string | null;
    chunkTranscripts: { chunkIndex: number; text: string }[];
    chunkExtractions: { chunkIndex: number; data: ChunkExtractionJson }[];
  }): Promise<LectureNotesJson> {
    const client = getOpenAIClient();
    const payload = {
      lectureTitle: input.lectureTitle,
      chunks: input.chunkTranscripts
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((t) => {
          const ext = input.chunkExtractions.find(
            (e) => e.chunkIndex === t.chunkIndex,
          );
          return {
            chunkIndex: t.chunkIndex,
            transcript: t.text,
            extraction: ext?.data ?? null,
          };
        }),
    };

    const completion = await client.chat.completions.parse({
      model: env.OPENAI_STRUCTURED_MODEL,
      messages: [
        {
          role: "system",
          content: `You merge per-chunk lecture notes into one final document. Rules:
- Use ONLY content supported by the provided transcripts and extractions. Never invent material.
- Never use boilerplate, template, or placeholder text; every sentence must reflect the supplied chunks.
- Remove obvious duplicates across chunks; keep important detail.
- The output JSON must have "title" (string) and "sections" (array of { "heading", "body" }).
- Sections must appear in this exact order with these exact headings: Summary, Key Concepts, Definitions, Examples, Questions, Reminders. Do not include a Transcript section (the server appends the verbatim transcript).
- "body" is plain text; use newlines and bullet lines (- item) where helpful.`,
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      response_format: zodResponseFormat(
        lectureNotesJsonSchema,
        "lecture_notes",
      ),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      const refusal = completion.choices[0]?.message.refusal;
      throw new Error(refusal ?? "Final notes returned no parsed content");
    }
    const headings = parsed.sections.map((s) => s.heading);
    for (const expected of [
      "Summary",
      "Key Concepts",
      "Definitions",
      "Examples",
      "Questions",
      "Reminders",
    ] as const) {
      if (!headings.includes(expected)) {
        log(
          "warn",
          "Final notes missing expected PRD heading; model output may be incomplete",
          { expected, headings },
        );
      }
    }
    return parsed;
  }
}

export const lectureAiService = new LectureAiService();
