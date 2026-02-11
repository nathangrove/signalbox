-- Add summary and action to ai_metadata
ALTER TABLE ai_metadata
  ADD COLUMN IF NOT EXISTS summary text;

ALTER TABLE ai_metadata
  ADD COLUMN IF NOT EXISTS action jsonb;