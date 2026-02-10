# Signalbox

![Signalbox Logo](web/public/logo-white-text.svg)

Only the signal. None of the noise.

> AI that sorts, prioritizes, and summarizes your email automatically.

---

## What is Signalbox

Signalbox is a web-based email client that uses a lightweight local classifier to categorize and prioritize messages, and a large language model (LLM) to generate concise summaries of important emails so you can focus on what matters. This repository contains the frontend (Vite + React + MUI), a NestJS backend, an email classifier service, trained model artifacts, and helper scripts for importing and processing mail.

## Repository overview

This repository contains the components needed to run Signalbox end-to-end: a React frontend, a TypeScript NestJS server, supporting data models and migrations, and a small classifier service used for AI-driven categorization and summarization.

## Repo tour

- **`web/`**: Frontend (Vite + React + TypeScript). App entrypoint, UI components, styles, and static assets live here.
- **`server/`**: NestJS backend implementing HTTP APIs, auth, worker processes, and integration with IMAP/SMTP sync.
- **`classifier/`**: Python service and training scripts for the lightweight email classifier used by the app.
- **`prisma/`**: Prisma schema and database migrations; used by the server to manage persistence.
- **`models/`**: Trained model artifacts and related files.
- **`scripts/` & `tmp/`**: Misc scripts, utilities, and temporary helper tools used during development and data imports.
- **Docker and infra**: `docker-compose.yml` and Dockerfiles at the repo root and in subfolders for containerized development.

## Features

- Automatic categorization and summarization
- Prioritization of important messages
- PWA-ready frontend with static assets served from `web/public`
- IMAP/SMTP account sync (server)
- Lightweight UI with keyboard-friendly navigation

## Integrations

- **Standard IMAP**: syncs with most email providers via IMAP for fetching and keeping accounts in sync.
- **Google OAuth (IMAP)**: first-class support for Gmail accounts using OAuth-based authentication and IMAP access.
- **LLM providers**: cloud LLMs (OpenAI) and local hosting via Ollama are supported for generating concise summaries and other AI features. Configure the provider and credentials via the server environment (e.g. `OPENAI_API_KEY`, `OLLAMA_URL`).

## Quick start (frontend)

Requirements: Node.js 18+, npm

```bash
cd web
npm ci
npm run dev
# Open the dev server URL printed by Vite
```

## Build for production

```bash
cd web
npm ci
npm run build
# Serve the contents of web/dist with your static host
```

## Development notes

- The frontend exposes static assets placed in `web/public` at the site root (e.g. `/icons/*`, `/manifest.webmanifest`).
- The service worker (`web/sw.js`) caches the manifest and static assets; ensure these files are present in production.

## Roadmap / TODO

Planned improvements and features:

- Make categories configurable (user-defined classification labels and rules).
- Add Microsoft IMAP integration (support for Microsoft/Outlook accounts).
- Implement a summary dashboard for aggregated summaries and stats.
- Add proper event parsing and calendar sync (detect invites, parse events, sync with calendars).

## Contributing

Contributions welcome. Please open issues or PRs for bug fixes, improvements, or design tweaks.

## License

This project is currently unlicensed. Add a LICENSE file if you wish to apply a specific license.

## Contact

Project maintained by the Signalbox team.
