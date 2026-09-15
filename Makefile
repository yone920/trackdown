.PHONY: install backend pg pg-migrate pg-stop pg-reset typecheck test lint app docker-prod docker-prod-down rollback status version

APP_VERSION := $(shell sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' backend/package.json | head -1)
GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null)

version:
	@echo "APP_VERSION = $(if $(APP_VERSION),$(APP_VERSION),(empty — deploys will be refused))"
	@echo "GIT_SHA     = $(if $(GIT_SHA),$(GIT_SHA),(empty — /health will report unknown))"

install:
	npm install
	cd backend && npm install

# ── Local development ────────────────────────────────────────────────────────

# Postgres in Docker, backend on the host with hot reload
pg:
	docker compose -f docker-compose.dev.yml up -d --wait postgres

pg-migrate:
	cd backend && npm run db:migrate

pg-stop:
	docker compose -f docker-compose.dev.yml stop postgres

pg-reset:
	docker exec trackdown-postgres-dev psql -U trackdown -d trackdown -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	cd backend && npm run db:migrate

backend:
	cd backend && npm run dev

# Expo dev server (see README for the Tailscale hostname dance)
app:
	npx expo start

typecheck:
	cd backend && npm run typecheck
	npx tsc --noEmit

# Backend tests run against an embedded Postgres — no Docker needed
test:
	cd backend && npm test

lint:
	cd backend && npm run lint
	npx expo lint

# ── Production (run on the Docker host, in this checkout) ────────────────────

docker-prod:
	@test -n "$(APP_VERSION)" || { echo "❌ could not read the version from backend/package.json"; exit 1; }
	@test -f .env.production || { echo "❌ .env.production is missing — see .env.example"; exit 1; }
	@echo "🚀 Deploying $(APP_VERSION) ($(if $(GIT_SHA),$(GIT_SHA),unknown))"
	APP_VERSION=$(APP_VERSION) GIT_SHA=$(GIT_SHA) docker compose --env-file .env.production up --build -d
	docker tag trackdown-backend:$(APP_VERSION) trackdown-backend:latest
	@echo "✅ Deployed trackdown-backend:$(APP_VERSION) (also :latest)"

docker-prod-down:
	docker compose --env-file .env.production down

# make rollback VERSION=x.y.z — only versions deployed on this host exist as tags
rollback:
	@test -n "$(VERSION)" || { echo "Usage: make rollback VERSION=x.y.z"; exit 1; }
	@docker image inspect trackdown-backend:$(VERSION) >/dev/null 2>&1 || { \
		echo "❌ no image trackdown-backend:$(VERSION) on this host. Available:"; \
		docker images --format '{{.Repository}}:{{.Tag}}' | grep trackdown- | sort | sed 's/^/   /'; exit 1; }
	docker tag trackdown-backend:$(VERSION) trackdown-backend:latest
	docker compose --env-file .env.production up -d
	@echo "✅ Rolled back to $(VERSION)"

status:
	@docker ps --filter name=trackdown --format '  {{.Names}}\t{{.Status}}' | grep . || echo "  no trackdown containers running"
	@printf '  /health   '; curl -fsS -m 5 http://localhost:8003/health 2>/dev/null || printf 'DOWN'; echo
