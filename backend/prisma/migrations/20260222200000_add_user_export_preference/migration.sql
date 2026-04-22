-- CreateEnum
CREATE TYPE "user_export_preference" AS ENUM ('auto', 'manual');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "export_preference" "user_export_preference" NOT NULL DEFAULT 'manual';
