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
# The migration runner reads these at container start (see docker-compose.yml command):
# the SQL files, and the exercise catalogue it seeds afterwards.
COPY migrations ./migrations
COPY data ./data

# The evidence volume mounts here (docker-compose.yml). It has to exist in the image and
# be owned by `node`: Docker seeds a fresh named volume from the image's directory —
# ownership included — and creates it root-owned if the path is missing, which the
# unprivileged process could then not write to.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Apply pending migrations, import the exercise illustrations, then serve. All three are
# idempotent, so a restart is safe.
#
# The import is deliberately NOT allowed to stop the boot: it is the only step here that
# needs the internet, and an exercise sheet without pictures is a working screen while a
# container that will not start is an outage. With the uploads volume already populated it
# short-circuits before it even fetches the dataset, so a restart costs nothing.
CMD ["sh", "-c", "node dist/db/migrate.js && { node dist/scripts/import-exercise-media.js || echo '⚠️  Exercise illustrations were not imported — sheets will show names only. Re-run: npm run import-exercise-media'; } && node dist/server.js"]
