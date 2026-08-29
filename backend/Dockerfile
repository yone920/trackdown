# TrackDown API — multi-stage build, same layout as My Read Coach's backend.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# Surfaced at /health; passed in from the host because this build context has no .git
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# The migration runner reads these at container start (see docker-compose.yml command)
COPY migrations ./migrations

USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Apply pending migrations, then serve. Both are idempotent, so a restart is safe.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
