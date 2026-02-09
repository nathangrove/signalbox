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

