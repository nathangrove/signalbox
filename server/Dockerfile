# Minimal production Dockerfile for the server
# This image expects the server JS to be present in `dist/` (the repo ships `dist/`).
# It installs production dependencies and runs `npm start`.

FROM node:20-slim

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled build output
COPY dist ./dist

# Copy any runtime assets the app might need (e.g., prisma config references)
COPY prisma.config.ts .. || true

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
