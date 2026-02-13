# NotJAEC Server (NestJS) — Local dev

Prerequisites: Node.js 18+, Docker (for docker-compose), and `pnpm`/`npm`.

Quick start (local dev):

```bash
# Start dev infra
docker-compose up -d postgres redis minio

# From project root
cd server
npm install
npm run prisma:generate
npm run start:dev
```

This scaffold starts a minimal NestJS server and BullMQ workers connected to `REDIS_URL`.

AI / LLM configuration
----------------------
You can use OpenAI-compatible endpoints, local Ollama, or GitHub Copilot as the LLM provider. Configure via environment variables in the project `.env`:

- `LLM_PROVIDER` — optional, `openai` (default) or `copilot`
- `OPENAI_API_KEY`, `OPENAI_API_BASE` — OpenAI-compatible credentials/base
- `OPENAI_MODEL` — single OpenAI model variable (replaces OPENAI_PARSE_MODEL / OPENAI_SUMMARY_MODEL)
- `COPILOT_API_KEY`, `COPILOT_API_BASE` — GitHub Copilot REST API credentials/base (when using Copilot)
- `COPILOT_MODEL` — optional model name for Copilot (falls back to `OPENAI_MODEL` if not set)

The server will prefer Copilot when `LLM_PROVIDER="copilot"` or when `COPILOT_API_KEY` is present.

Prisma migrations
-----------------

Run migrations in development (creates a migration and applies it):

```bash
# from /server
./scripts/prisma_migrate.sh dev
```

Apply migrations non-interactively (CI / production):

```bash
./scripts/prisma_migrate.sh deploy
```

