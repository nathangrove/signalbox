-- Initial schema migration for webmail
-- Assumes Postgres 15+, pgcrypto and pgvector extensions available

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- accounts
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider varchar NOT NULL,
  email varchar NOT NULL,
  encrypted_credentials bytea NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX accounts_email_idx ON accounts(email);

-- mailboxes
CREATE TABLE mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  path varchar NOT NULL,
  uid_validity bigint,
  last_sync_at timestamptz,
  flags_mirroring boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_id, path)
);

-- messages
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid bigint,
  uid_validity bigint,
  message_id text,
  x_gm_msgid numeric,
  subject text,
  from_header jsonb,
  to_header jsonb,
  cc_header jsonb,
  bcc_header jsonb,
  internal_date timestamptz,
  size_bytes int,
  flags text[] DEFAULT '{}',
  raw bytea,
  raw_path text,
  fetch_status varchar DEFAULT 'fetched',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX messages_account_mailbox_idx ON messages(account_id, mailbox_id);
CREATE INDEX messages_message_id_idx ON messages(message_id);
CREATE UNIQUE INDEX messages_mailbox_uid_uidvalidity_idx ON messages(mailbox_id, uid, uid_validity) WHERE uid IS NOT NULL;

-- message_versions
CREATE TABLE message_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  raw bytea,
  raw_path text,
  reason varchar,
  created_by varchar,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, version)
);

-- attachments
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename text,
  content_type text,
  size_bytes int,
  content_id text,
  sha256 bytea,
  stored_path text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX attachments_message_idx ON attachments(message_id);

-- ai_metadata
CREATE TABLE ai_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  model varchar NOT NULL,
  provider varchar NOT NULL,
  cache_key text,
  labels jsonb DEFAULT '{}'::jsonb,
  priority numeric,
  itinerary jsonb,
  tracking jsonb,
  events jsonb,
  raw_response jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, version)
);
CREATE INDEX ai_metadata_message_idx ON ai_metadata(message_id);
CREATE INDEX ai_metadata_cache_key_idx ON ai_metadata(cache_key);

-- embeddings
CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  ai_metadata_id uuid REFERENCES ai_metadata(id),
  chunk_id int NOT NULL DEFAULT 0,
  text_snippet text,
  vector vector(1536),
  provider varchar,
  model varchar,
  external_id text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX embeddings_vector_idx ON embeddings USING ivfflat (vector) WITH (lists = 1024);

-- events
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id),
  ai_metadata_id uuid REFERENCES ai_metadata(id),
  start_ts timestamptz,
  end_ts timestamptz,
  summary text,
  location text,
  attendees jsonb,
  source varchar,
  created_at timestamptz DEFAULT now()
);

-- sync_state
CREATE TABLE sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  last_uid bigint,
  last_modseq numeric,
  last_seen_history_id text,
  last_checked_at timestamptz,
  UNIQUE(mailbox_id)
);
