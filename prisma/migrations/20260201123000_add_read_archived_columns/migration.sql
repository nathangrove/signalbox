-- Add read and archived columns to messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS "read" boolean DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;