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
  private getParsedOrThrow<T>(input: {
    parsed: T | null | undefined;
    refusal: string | null | undefined;
    fallbackMessage: string;
  }): T {
    if (input.parsed) {
      return input.parsed;
    }

    throw new Error(input.refusal ?? input.fallbackMessage);
  }

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
          content: `You are an expert academic note-taker specializing in turning lecture segments into clean, structured study material for students.

Task: Extract ONLY information that is explicitly stated in the provided transcript segment. Never invent, infer, or add facts, examples, citations, or context.

Guidelines:
- Be precise, concise, and objective.
- If a field in the schema has no supporting content in this segment, use an empty array or the appropriate empty value.
- Prioritize educational value: pull out main ideas, terminology, explanations, examples, and any questions or action items mentioned.
- Do not summarize the whole lecture here — focus only on this segment.

Output must exactly match the "chunk_extraction" JSON schema.`,
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
    return this.getParsedOrThrow({
      parsed: completion.choices[0]?.message.parsed,
      refusal: completion.choices[0]?.message.refusal,
      fallbackMessage: "Chunk extraction returned no parsed content",
    });
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
          content: `You are an expert lecture note synthesizer. Your job is to turn per-chunk transcripts and extractions into one clean, cohesive, student-ready study document.

Input: A JSON object containing lectureTitle (may be null) and an ordered array of chunks. Each chunk includes the original transcript text and its structured extraction.

Strict rules:
- Use ONLY content that is explicitly supported by the provided transcripts and extractions. Never invent material, add external knowledge, make up examples, or create connections.
- Synthesize across chunks: remove obvious duplicates, keep all important detail and context, and organize logically by topic flow.
- If lectureTitle is null/empty, create a short, descriptive title (3–8 words) that captures the core subject of the lecture.
- Output must be valid JSON matching the "lecture_notes" schema: { "title": string, "sections": array of { "heading": string, "body": string } }

Section requirements (appear in this exact order with these exact headings — case-sensitive):
1. Summary → 3–6 sentence high-level overview of the entire lecture’s main themes and flow.
2. Key Concepts → Bullet list of the primary ideas, principles, theories, or arguments presented.
3. Definitions → Key terms with concise explanations (format as "- Term: definition" or clear bullets).
4. Examples → Any specific examples, illustrations, case studies, or demonstrations given in the lecture.
5. Questions → Any questions posed by the speaker/audience, rhetorical questions, or clear study/review questions implied by the content.
6. Reminders → Important takeaways, action items, follow-ups, exam tips, or things the speaker emphasized to remember.

Formatting rules for every "body":
- Plain text only (no Markdown beyond simple newlines and "- " bullets).
- Clear, concise, academic-yet-accessible language that a student can copy straight into a Google Doc.
- Use newlines for paragraphs and "- " bullets for lists to maximize scannability.
- If a section has no supported content, use a short body like "No relevant information appears in the lecture." (never leave completely blank unless your schema requires it).

Every sentence must be traceable to the supplied chunks. Produce notes that are immediately useful for review and exam preparation. Do not include a Transcript section (the server will append the full verbatim transcript).`,
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
    const parsed = this.getParsedOrThrow({
      parsed: completion.choices[0]?.message.parsed,
      refusal: completion.choices[0]?.message.refusal,
      fallbackMessage: "Final notes returned no parsed content",
    });

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
          "Final notes missing expected heading; model output may be incomplete",
          { expected, headings },
        );
      }
    }

    return parsed;
  }
}

export const lectureAiService = new LectureAiService();
