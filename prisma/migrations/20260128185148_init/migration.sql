/*
  Warnings:

  - Made the column `created_at` on table `accounts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `accounts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `ai_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `attachments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `embeddings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `events` required. This step will fail if there are existing NULL values in that column.
  - Made the column `flags_mirroring` on table `mailboxes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `mailboxes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `message_versions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_metadata" DROP CONSTRAINT "ai_metadata_message_id_fkey";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_message_id_fkey";

-- DropForeignKey
ALTER TABLE "embeddings" DROP CONSTRAINT "embeddings_ai_metadata_id_fkey";

-- DropForeignKey
ALTER TABLE "embeddings" DROP CONSTRAINT "embeddings_message_id_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_ai_metadata_id_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_message_id_fkey";

-- DropForeignKey
ALTER TABLE "mailboxes" DROP CONSTRAINT "mailboxes_account_id_fkey";

-- DropForeignKey
ALTER TABLE "message_versions" DROP CONSTRAINT "message_versions_message_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_account_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_mailbox_id_fkey";

-- DropForeignKey
ALTER TABLE "sync_state" DROP CONSTRAINT "sync_state_mailbox_id_fkey";

-- DropIndex
DROP INDEX "ai_metadata_cache_key_idx";

-- DropIndex
DROP INDEX "ai_metadata_message_idx";

-- DropIndex
DROP INDEX "attachments_message_idx";

-- DropIndex
DROP INDEX "embeddings_vector_idx";

-- DropIndex
DROP INDEX "messages_account_mailbox_idx";

-- DropIndex
DROP INDEX "messages_message_id_idx";

-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "config" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "ai_metadata" ALTER COLUMN "labels" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "embeddings" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "events" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "mailboxes" ALTER COLUMN "flags_mirroring" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "message_versions" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "fetch_status" DROP DEFAULT,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_versions" ADD CONSTRAINT "message_versions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_metadata" ADD CONSTRAINT "ai_metadata_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_ai_metadata_id_fkey" FOREIGN KEY ("ai_metadata_id") REFERENCES "ai_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_ai_metadata_id_fkey" FOREIGN KEY ("ai_metadata_id") REFERENCES "ai_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "accounts_email_idx" RENAME TO "accounts_email_key";
