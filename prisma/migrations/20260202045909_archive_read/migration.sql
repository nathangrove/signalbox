/*
  Warnings:

  - Made the column `read` on table `messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `archived` on table `messages` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "config" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "ai_metadata" ALTER COLUMN "labels" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "read" SET NOT NULL,
ALTER COLUMN "archived" SET NOT NULL;
