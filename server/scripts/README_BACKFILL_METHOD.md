Backfill `ai_metadata.labels.method`

This folder contains a SQL script to infer and write a `method` field into `ai_metadata.labels` for existing rows.

How it works
- Marks rows as `local-model` when `raw_response` contains `spam_probability` or `category_probs` (these are produced by the local classifier service).
- Marks rows as `llm` when `raw_response` contains `choices` (typical LLM response structure).
- Marks rows as `heuristic` when an existing `labels.categoryReason` starts with `heuristic`.
- Marks rows as `manual` when `labels.modified_by` or `labels.modified_at` are present.

Run
1. Ensure your `DATABASE_URL` env var points to your Postgres instance.
2. From repository root run:

```bash
psql "$DATABASE_URL" -f server/scripts/backfill_ai_method.sql
```

Or, if your DB is run inside docker-compose and you don't have `psql` locally, use the postgres container (adjust service name if different):

```bash
docker compose exec webmail-postgres-1 psql "$DATABASE_URL" -f /workspace/server/scripts/backfill_ai_method.sql
```

Notes
- The heuristics are conservative but not perfect — review results before trusting them for analytics.
- If you'd like, I can run the script for you (I won't run DB-affecting commands without your explicit approval).
