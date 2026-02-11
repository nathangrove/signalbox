-- Migration: add users table and foreign key from accounts.user_id -> users.id

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar NOT NULL UNIQUE,
  password_hash text,
  created_at timestamptz DEFAULT now()
);

-- Add FK constraint from accounts.user_id to users.id if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_user_id_fkey'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
