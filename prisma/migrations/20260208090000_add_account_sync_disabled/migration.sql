-- Add per-account sync disable flag
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS sync_disabled boolean NOT NULL DEFAULT false;
