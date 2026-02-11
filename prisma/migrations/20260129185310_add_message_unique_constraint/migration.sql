/*
  Warnings:

  - A unique constraint covering the columns `[mailbox_id,uid]` on the table `messages` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "config" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "ai_metadata" ALTER COLUMN "labels" SET DEFAULT '{}'::jsonb;

-- CreateIndex
CREATE UNIQUE INDEX "messages_mailbox_id_uid_key" ON "messages"("mailbox_id", "uid");
