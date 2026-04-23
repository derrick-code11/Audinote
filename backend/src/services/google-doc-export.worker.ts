import { google } from "googleapis";

import { prisma } from "../config/prisma";
import { lectureNotesJsonSchema } from "../types/lecture-notes";
import { googleTokenService } from "./google-token.service";
import { log } from "../utils/logger";

export class GoogleDocExportWorker {
  private inflight = false;

  private static readonly DEFAULT_DOC_TITLE = "Audinote export";

  private getDocTitle(notesJson: unknown): string {
    const maybeTitle = (notesJson as { title?: unknown }).title;
    return typeof maybeTitle === "string" ? maybeTitle : GoogleDocExportWorker.DEFAULT_DOC_TITLE;
  }

  private buildInsertRequests(
    notesJson: unknown,
    insertIndex: number
  ): Array<{ insertText: { location: { index: number }; text: string } }> {
    const parsed = lectureNotesJsonSchema.safeParse(notesJson);
    const fallbackText = `${JSON.stringify(notesJson, null, 2)}\n`;
    const requests: Array<{ insertText: { location: { index: number }; text: string } }> = [];

    if (!parsed.success) {
      requests.push({
        insertText: {
          location: { index: insertIndex },
          text: fallbackText,
        },
      });
      return requests;
    }

    const blocks: string[] = [parsed.data.title, ""];
    for (const section of parsed.data.sections) {
      blocks.push(section.heading);
      blocks.push(section.body);
      blocks.push("");
    }

    for (let i = blocks.length - 1; i >= 0; i--) {
      requests.push({
        insertText: {
          location: { index: insertIndex },
          text: `${blocks[i]}\n`,
        },
      });
    }

    return requests;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "EXPORT_FAILED";
  }

  private async claimPendingExport(): Promise<{
    id: string;
    lectureId: string;
    userId: string;
  } | null> {
    const pending = await prisma.googleDocExport.findFirst({
      where: { status: "PENDING" },
      orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
      select: { id: true, lectureId: true, userId: true, attemptedAt: true },
    });
    if (!pending) {
      return null;
    }

    const claimed = await prisma.googleDocExport.updateMany({
      where: {
        id: pending.id,
        status: "PENDING",
        attemptedAt: pending.attemptedAt,
      },
      data: { attemptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      return null;
    }

    return {
      id: pending.id,
      lectureId: pending.lectureId,
      userId: pending.userId,
    };
  }

  async tick(): Promise<void> {
    if (this.inflight) {
      return;
    }
    this.inflight = true;
    let exportId: string | null = null;
    try {
      const pending = await this.claimPendingExport();
      if (!pending) {
        return;
      }
      exportId = pending.id;

      const lecture = await prisma.lecture.findFirst({
        where: { id: pending.lectureId, deletedAt: null },
      });
      if (!lecture || lecture.status !== "DONE") {
        return;
      }

      const note = await prisma.lectureNote.findFirst({
        where: { lectureId: pending.lectureId, deletedAt: null, status: "READY" },
      });
      if (!note) {
        return;
      }

      const oauth2 = await googleTokenService.getOAuth2ClientForUser(pending.userId);
      const docs = google.docs({ version: "v1", auth: oauth2 });

      const title = this.getDocTitle(note.notesJson);

      const created = await docs.documents.create({
        requestBody: { title },
      });
      const documentId = created.data.documentId;
      if (!documentId) {
        throw new Error("Google Docs did not return a documentId");
      }

      const doc = await docs.documents.get({ documentId });
      const endIndex = doc.data.body?.content?.[0]?.endIndex;
      if (!endIndex) {
        throw new Error("Failed to read created Google Doc to determine insertion index");
      }
      const insertIndex = Math.max(1, endIndex - 1);

      const requests = this.buildInsertRequests(note.notesJson, insertIndex);

      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });

      const url = `https://docs.google.com/document/d/${documentId}/edit`;

      await prisma.googleDocExport.update({
        where: { id: pending.id },
        data: {
          status: "SUCCESS",
          googleDocId: documentId,
          googleDocUrl: url,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      log("info", "Google Doc export completed", { exportId: pending.id, lectureId: pending.lectureId });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      log("error", "Google Doc export failed", { error: errorMessage });
      if (exportId) {
        await prisma.googleDocExport.update({
          where: { id: exportId },
          data: {
            status: "FAILED",
            errorMessage,
            completedAt: new Date(),
          },
        });
      }
    } finally {
      this.inflight = false;
    }
  }
}

export const googleDocExportWorker = new GoogleDocExportWorker();
