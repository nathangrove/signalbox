-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "config" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "ai_metadata" ALTER COLUMN "labels" SET DEFAULT '{}'::jsonb;
