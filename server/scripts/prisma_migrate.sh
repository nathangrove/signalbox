#!/usr/bin/env bash
set -euo pipefail

# Helper script to run Prisma commands for local development
# Usage: ./prisma_migrate.sh [dev|deploy]

CMD="${1:-dev}"

if [ "$CMD" = "dev" ]; then
  echo "Running prisma migrate dev (interactive)"
  npx prisma generate
  npx prisma migrate dev --name init
  exit 0
fi

if [ "$CMD" = "deploy" ]; then
  echo "Running prisma migrate deploy (non-interactive)"
  npx prisma generate
  npx prisma migrate deploy
  exit 0
fi

echo "Unknown command: $CMD"
exit 2
