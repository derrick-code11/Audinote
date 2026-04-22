import { google } from "googleapis";

import { prisma } from "../config/prisma";
import { googleTokenService } from "./google-token.service";
import { log } from "../utils/logger";

export class GoogleDocExportWorker {
  private inflight = false;

  async tick(): Promise<void> {
    if (this.inflight) {
      return;
    }
    this.inflight = true;
    let exportId: string | null = null;
    try {
      const pending = await prisma.googleDocExport.findFirst({
        where: { status: "PENDING" },
        orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
      });
      if (!pending) {
        return;
      }
      exportId = pending.id;

      await prisma.googleDocExport.update({
        where: { id: pending.id },
        data: { attemptedAt: new Date() },
      });

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

      const title =
        typeof (note.notesJson as { title?: unknown }).title === "string"
          ? ((note.notesJson as { title: string }).title as string)
          : "Audinote export";

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

      const text = JSON.stringify(note.notesJson, null, 2);
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: insertIndex },
                text: `${text}\n`,
              },
            },
          ],
        },
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
      log("error", "Google Doc export failed", { error: (error as Error).message });
      if (exportId) {
        await prisma.googleDocExport.update({
          where: { id: exportId },
          data: {
            status: "FAILED",
            errorMessage: (error as Error).message || "EXPORT_FAILED",
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
