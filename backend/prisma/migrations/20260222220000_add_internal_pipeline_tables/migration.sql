-- CreateEnum
CREATE TYPE "lecture_chunk_status" AS ENUM ('pending', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "processing_attempt_status" AS ENUM ('started', 'success', 'failed');

-- CreateTable
CREATE TABLE "lecture_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lecture_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "status" "lecture_chunk_status" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lecture_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunk_transcripts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chunk_id" UUID NOT NULL,
    "transcript_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunk_extractions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chunk_id" UUID NOT NULL,
    "extraction_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_step_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lecture_id" UUID NOT NULL,
    "chunk_id" UUID,
    "step_name" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "processing_attempt_status" NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_step_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_chunks_lecture_index" ON "lecture_chunks"("lecture_id", "chunk_index");

-- CreateIndex
CREATE INDEX "idx_chunks_status" ON "lecture_chunks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_transcripts_chunk_id_key" ON "chunk_transcripts"("chunk_id");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_extractions_chunk_id_key" ON "chunk_extractions"("chunk_id");

-- AddForeignKey
ALTER TABLE "lecture_chunks" ADD CONSTRAINT "lecture_chunks_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_transcripts" ADD CONSTRAINT "chunk_transcripts_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "lecture_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_extractions" ADD CONSTRAINT "chunk_extractions_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "lecture_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_step_attempts" ADD CONSTRAINT "processing_step_attempts_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_step_attempts" ADD CONSTRAINT "processing_step_attempts_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "lecture_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Check constraints (match docs/Database-Schema.md)
ALTER TABLE "lecture_chunks" ADD CONSTRAINT "chk_chunks_index" CHECK ("chunk_index" >= 0);
ALTER TABLE "lecture_chunks" ADD CONSTRAINT "chk_chunks_start" CHECK ("start_ms" >= 0);
ALTER TABLE "lecture_chunks" ADD CONSTRAINT "chk_chunks_end" CHECK ("end_ms" > "start_ms");
ALTER TABLE "lecture_chunks" ADD CONSTRAINT "chk_chunks_duration" CHECK ("duration_ms" = "end_ms" - "start_ms");
ALTER TABLE "lecture_chunks" ADD CONSTRAINT "chk_chunks_attempt_count" CHECK ("attempt_count" >= 0);

ALTER TABLE "processing_step_attempts" ADD CONSTRAINT "chk_attempts_attempt_number" CHECK ("attempt_number" >= 1);

-- Safer uniqueness than NULL-problematic UNIQUE(lecture_id, chunk_id, ...)
CREATE UNIQUE INDEX "uq_attempts_lecture_chunk_step_attempt" ON "processing_step_attempts"("lecture_id", "chunk_id", "step_name", "attempt_number")
WHERE "chunk_id" IS NOT NULL;

CREATE UNIQUE INDEX "uq_attempts_lecture_step_attempt_no_chunk" ON "processing_step_attempts"("lecture_id", "step_name", "attempt_number")
WHERE "chunk_id" IS NULL;

-- CreateIndex
CREATE INDEX "idx_attempts_lecture_step_started" ON "processing_step_attempts"("lecture_id", "step_name", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_attempts_chunk_step_started" ON "processing_step_attempts"("chunk_id", "step_name", "started_at" DESC) WHERE "chunk_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "idx_attempts_status_started" ON "processing_step_attempts"("status", "started_at" DESC);
