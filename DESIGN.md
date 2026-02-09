# NotJAEC — Not Just Another Email Client — Design Document

## Executive summary

Build a server-side webmail system that fetches mail from generic IMAP providers, stores canonical copies on the server, and runs an AI pipeline to label, sort/prioritize, and extract structured data (itineraries, shipment tracking codes, calendar events). The system stores versioned AI metadata and embeddings in Postgres (with `pgvector`) or an external vector DB, and supports OpenAI (with configurable `api_base`) and Ollama as pluggable LLM providers.

Goals:
- Centralized, multi-device access to AI-generated metadata and search
- Reliable IMAP sync with UID/UIDVALIDITY handling
- Auditable, versioned AI metadata and embeddings
- Privacy-first defaults with opt-in raw-content retention

Non-goals:
- Detailed frontend UI designs
- Carrier-specific real-time verification beyond optional API enrichment

---

## High-level architecture

- Components:
- API server: Node.js + NestJS for REST and admin APIs
- Worker system: BullMQ (Redis) for background sync, parsing, and AI tasks; Temporal or RabbitMQ are alternatives for complex workflows
- Database: Postgres 15+ with `pgvector` extension (or Postgres + external vector DB)
- Vector DB (optional): Weaviate / Milvus / Pinecone for large-scale similarity search
- Storage: S3-compatible object storage (MinIO/AWS S3) for attachments & large raw blobs
- LLM adapters: OpenAI client (configurable `api_base`) and Ollama adapter
- Monitoring: Prometheus + Grafana, central logging (ELK)

Flow:
1. Fetchers connect to IMAP, fetch messages (headers first), store canonical messages and references to raw blobs.
2. Parser tasks extract text, MIME parsing, attachments; enqueue embedding and LLM extraction jobs.
3. Embeddings saved in `embeddings` (pgvector or external), AI outputs saved in `ai_metadata` (versioned).
4. API server exposes messages, metadata, semantic search, and reprocess endpoints.

Recommended stack: Node.js (18+), NestJS, BullMQ + Redis, Prisma (or TypeORM), Postgres (pgvector), S3, OpenAI/Ollama.

---

## Data model (Postgres DDL)

Assumes `pgvector` and `pgcrypto` are available. Adjust embedding dimension to match chosen model (example uses 1536).

```sql
-- Extensions
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
CREATE UNIQUE INDEX ON accounts(email);

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
CREATE INDEX ON messages(account_id, mailbox_id);
CREATE INDEX ON messages(message_id);
CREATE UNIQUE INDEX ON messages(mailbox_id, uid, uid_validity) WHERE uid IS NOT NULL;

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
CREATE INDEX ON attachments(message_id);

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
CREATE INDEX ON ai_metadata(message_id);
CREATE INDEX ON ai_metadata(cache_key);

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
```

---

## IMAP identifiers mapping and edge cases

- Canonical local identity: `messages.id` (UUID).
- Matching priority when syncing:
  1. Exact `(mailbox_id, uid, uid_validity)` match — update the row.
  2. If UIDVALIDITY changed or UID absent — match by `Message-ID` header (case-insensitive).
  3. If present (Gmail), use `X-GM-MSGID` or `X-GM-THRID` when available for stable identity.
  4. Fallback: normalized header hash + size + internal_date heuristics.

Edge cases:
- UIDVALIDITY change: mark mailbox rows stale and re-sync; try to remap by `Message-ID` to recover message rows.
- Message moves: detect by `Message-ID` presence in different mailbox and update `mailbox_id` instead of creating duplicates.
- Deletions: use soft-delete flags and purge per retention policy.

---

## Sync strategy

Initial sync:
- Create mailbox row with `uid_validity`.
- Fetch headers in batches (500–2000 UIDs) storing metadata and a small snippet; prioritize recent days for full-body fetch.

Incremental sync:
- Use `CONDSTORE`/`MODSEQ` and `UIDPLUS` where available to detect changes.
- Persist `last_uid`/`last_modseq` in `sync_state` and fetch deltas.

Real-time options:
- IMAP IDLE for push notifications (persistent connections) with reconnect/backoff.
- Polling fallback (1–5 minutes) if IDLE not available.
- Gmail Pub/Sub (recommended for Gmail) or Outlook Graph webhooks as provider-specific push mechanisms.

Reconciliation:
- On `UIDVALIDITY` change, re-scan mailbox and reconcile by `Message-ID` and `x_gm_msgid` to prevent duplicates.

---

## LLM integration & pipeline

Pipeline stages:
1. Preprocessing: decode MIME, extract HTML→text, strip signatures/quoted blocks, normalize dates.
2. Chunking: segment into ~800–1500 token chunks (semantic sentence boundaries), 10–20% overlap.
3. Embeddings: batch embeddings per chunk, store in `embeddings`.
4. Retrieval & LLM extraction: RAG-style retrieval of top-k chunks, use schema-driven prompts to extract JSON.
5. Postprocessing: validate and normalize dates, tracking codes, and store results in `ai_metadata`.

Prompt design:
- Provide `metadata` and `chunk` in prompt and require JSON-only output matching expected schema.
- Use `cache_key = hash(model + prompt_template + chunk_hash)` for dedup and caching.

Provider adapters:
- OpenAI: support `api_base` in config (for LM Studio/custom endpoints) and `api_key`.
- Ollama: call local Ollama HTTP API as an alternative provider.

Batching & caching:
- Batch embedding calls when supported.
- Cache embedding results and LLM outputs when `cache_key` matches to reduce cost.

Model & cost guidance:
- Use smaller models for classification/extraction, larger ones for summarization where needed.
- Minimize context by using retrieval instead of full-message injection.

---

## Extraction techniques (practical)

- Itineraries: combine regex (flight number patterns), HTML table parsing, NER for airports/dates, date normalization and validation against IATA lists.
- Tracking: maintain carrier regex catalog (UPS, USPS, FedEx, DHL, Amazon patterns), validate checksums where possible, and optionally verify with carrier APIs.
- Events: parse `text/calendar` attachments first; then use NER/date parsing to infer implicit events in body text.

Validation: run checksum/date plausibility checks and assign confidence scores; surface low-confidence items for human review.

---

## Metadata storage & mirroring

- Primary store: `ai_metadata` table (structured JSON, versioned) — recommended.
- Embeddings: store in Postgres `vector` (pgvector) for small/medium scale; use external vector DB for larger scale.
- Optional mirroring: write small IMAP keywords/flags when user grants write permission for UX parity (e.g., add `ai:itinerary` keyword). Keep external DB as source-of-truth.

---

## Security & privacy

- Transport: TLS for IMAP/HTTPS; mTLS for service-to-service where needed.
- At-rest: Postgres volumes encrypted, envelope encryption for sensitive fields using KMS (AWS/GCP/Azure) or Vault.
- Redaction: default PII redaction before sending to cloud LLMs unless user opts in.
- Consent & GDPR: per-account opt-out for AI processing, data export & deletion flows, audit logs for model calls (prompt hash, model, timestamp).

---

## Scaling & operations

- Worker queues by responsibility: `fetch`, `parse`, `embeddings`, `ai`, `attachments`.
- Use per-account and global rate limiting; exponential backoff with jitter for retries.
- Metrics: queue depth, sync lag, LLM spend; alerts on auth failures and unusual UIDVALIDITY churn.

---

## API surface (examples)

- `GET /v1/accounts` — list accounts
- `POST /v1/accounts` — add account (triggers initial sync)
- `GET /v1/accounts/{id}/mailboxes` — list mailboxes
- `GET /v1/messages?mailbox_id={}&limit=50` — list messages
- `GET /v1/messages/{id}` — message details (includes latest ai_metadata reference)
- `POST /v1/messages/{id}/reprocess` — re-run AI tasks

Response shapes are simple JSON objects containing `id`, `subject`, `from`, `internal_date`, `labels`, `priority`.

---

## Repo layout suggestions

- `server/` — NestJS app (API, auth, admin)
- `workers/` — BullMQ workers and processors
- `llm/` — adapters for providers
- `db/` — Prisma schema / migrations and DDL
- `parsers/` — MIME and text extraction
- `storage/` — S3 helpers
- `infra/` — k8s/compose/terraform

---

## MVP roadmap (6 steps)

1. Account connect & initial header-only sync; store canonical message rows.
2. Persistent incremental sync (polling/IDLE fallback) and `sync_state`.
3. ✅ MIME parsing and text extraction; basic message listing API. (messages being parsed and inserted)
4. Basic LLM labeling pipeline (small model/rules) and store `ai_metadata`.
5. Embeddings + semantic search using `pgvector`.
6. Itinerary/tracking/event extraction with validation and privacy controls.

Remaining issues: Connection limit (rate limiting or pooling needed for scalability).

---

## Cost & privacy tradeoffs

- Postgres + pgvector: low infra complexity, suitable for small-to-medium scale.
- External vector DB: higher cost, better performance at scale.
- Cloud LLMs: fast iteration, recurring token costs and external data transfer; Ollama: on-premise control, higher operational overhead.

---

## Open questions

1. Preferred retention policy for raw message bodies and LLM outputs?
2. Default AI processing mode: opt-in or opt-out?
3. Any data residency constraints for embeddings/LLM calls?
4. Primary carriers to prioritize for tracking verification?
5. Expected SLO for 'real-time' metadata availability (e.g., index within 1 minute)?

---

## Next steps

- Create DB migrations (I can generate Prisma migration/SQL DDL).
- Scaffold a minimal NestJS + BullMQ + Prisma project with a basic IMAP fetcher.
- Create a `docker-compose.yml` for local dev with Postgres (pgvector), Redis, and MinIO.

If you want one of those generated now, tell me which and I’ll scaffold it.
