import { z } from "zod";

/** Intermediate extraction per chunk. */
export const chunkExtractionSchema = z.object({
  summaryBullets: z.array(z.string()),
  keyConcepts: z.array(z.string()),
  definitions: z.array(z.object({ term: z.string(), definition: z.string() })),
  examples: z.array(z.string()),
  questions: z.array(z.string()),
  reminders: z.array(z.string()),
});

export type ChunkExtractionJson = z.infer<typeof chunkExtractionSchema>;

/** Final persisted `notesJson` shape. */
export const lectureNotesJsonSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
    }),
  ),
});

export type LectureNotesJson = z.infer<typeof lectureNotesJsonSchema>;

export const SECTION_HEADINGS = [
  "Summary",
  "Key Concepts",
  "Definitions",
  "Examples",
  "Questions",
  "Reminders",
  "Transcript",
] as const;

/** Join per-chunk ASR text in lecture order (verbatim, no LLM). */
export function mergeChunkTranscriptBodies(
  chunkTranscripts: { chunkIndex: number; text: string }[],
): string {
  return chunkTranscripts
    .slice()
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((c) => c.text.trimEnd())
    .filter((t) => t.length > 0)
    .join("\n\n");
}

/** Drop any model-produced Transcript section and append the real ASR merge. */
export function withVerbatimTranscriptSection(
  notes: LectureNotesJson,
  transcriptBody: string,
): LectureNotesJson {
  const sections = notes.sections.filter((s) => s.heading !== "Transcript");
  return {
    ...notes,
    sections: [...sections, { heading: "Transcript", body: transcriptBody }],
  };
}
