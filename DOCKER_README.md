Quick Docker deployment
-----------------------

1. Copy environment example to `.env` and edit any secrets or URLs you care about:

```bash
cp .env.example .env
# edit .env
```

2. Build and start services (Postgres, Redis, MinIO, server, classifier):

```bash
docker-compose up --build -d
```

3. Run database migrations (from host or inside the `app` container). Example using the `app` container:

```bash
# Migrations are automatically attempted by the one-shot `prisma_migrate` service on `docker-compose up`.
# The migration service also runs `prisma generate` first so the Prisma client is generated for the server.
# If you need to run migrations manually or re-run them later:
docker-compose run --rm prisma_migrate sh -c "npm --prefix server install --silent && npx prisma generate --schema=prisma/schema.prisma && npx prisma migrate deploy --schema=prisma/schema.prisma"
```

4. Confirm services are running:

```bash
docker-compose ps
```

Notes
- `.env` is intentionally gitignored; keep secrets out of source control.
- By default this setup uses the provided dev credentials (Postgres `postgres:postgres`, MinIO `minio/minio123`). Change them in `.env` for production.
- If you need the frontend served from the server, set `FRONTEND_URL` appropriately.
