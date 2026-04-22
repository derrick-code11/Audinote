-- CreateEnum
CREATE TYPE "lecture_source_type" AS ENUM ('live_recording', 'file_upload');

-- CreateEnum
CREATE TYPE "lecture_status" AS ENUM ('uploading', 'processing', 'generating', 'done', 'failed');

-- CreateEnum
CREATE TYPE "lecture_note_status" AS ENUM ('ready', 'failed');

-- CreateEnum
CREATE TYPE "export_action" AS ENUM ('create', 'update', 'recreate');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('pending', 'success', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "google_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_google_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "google_email" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_google_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lectures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "source_type" "lecture_source_type" NOT NULL,
    "status" "lecture_status" NOT NULL,
    "duration_seconds" INTEGER,
    "error_message" TEXT,
    "processing_started_at" TIMESTAMPTZ,
    "processing_completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "lectures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecture_audio_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lecture_id" UUID NOT NULL,
    "part_number" INTEGER NOT NULL,
    "s3_bucket" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "duration_ms" INTEGER,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "deleted_from_storage_at" TIMESTAMPTZ,

    CONSTRAINT "lecture_audio_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecture_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lecture_id" UUID NOT NULL,
    "notes_json" JSONB NOT NULL,
    "status" "lecture_note_status" NOT NULL,
    "error_message" TEXT,
    "generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "lecture_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_doc_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lecture_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "google_doc_id" TEXT,
    "google_doc_url" TEXT,
    "action" "export_action" NOT NULL,
    "status" "export_status" NOT NULL,
    "error_message" TEXT,
    "attempted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_doc_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "user_google_accounts_user_id_key" ON "user_google_accounts"("user_id");

-- CreateIndex
CREATE INDEX "idx_lectures_user_created" ON "lectures"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_lectures_user_status" ON "lectures"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_audio_parts_expires_at" ON "lecture_audio_parts"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_audio_parts_lecture_part" ON "lecture_audio_parts"("lecture_id", "part_number");

-- CreateIndex
CREATE UNIQUE INDEX "lecture_notes_lecture_id_key" ON "lecture_notes"("lecture_id");

-- CreateIndex
CREATE INDEX "idx_exports_lecture_attempted" ON "google_doc_exports"("lecture_id", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_exports_user_attempted" ON "google_doc_exports"("user_id", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_exports_status_attempted" ON "google_doc_exports"("status", "attempted_at" DESC);

-- AddForeignKey
ALTER TABLE "user_google_accounts" ADD CONSTRAINT "user_google_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecture_audio_parts" ADD CONSTRAINT "lecture_audio_parts_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecture_notes" ADD CONSTRAINT "lecture_notes_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_doc_exports" ADD CONSTRAINT "google_doc_exports_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_doc_exports" ADD CONSTRAINT "google_doc_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
