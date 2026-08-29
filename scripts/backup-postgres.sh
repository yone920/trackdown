#!/usr/bin/env bash
#
# Nightly backup of TrackDown's self-hosted Postgres. Supabase was doing this silently;
# after cutover this script is the whole safety net.
#
#   BACKUP_DIR=/mnt/backups/trackdown ./scripts/backup-postgres.sh
#
# BACKUP_DIR must NOT be the Docker host's local disk — use a TrueNAS NFS mount so a
# disk failure cannot take the database and its backups together.
#
# Restore (rehearse before trusting it):
#   gunzip -c trackdown-YYYY-MM-DD_HHMMSS.sql.gz | \
#     docker exec -i trackdown-postgres psql -U trackdown -d restore_test

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:?BACKUP_DIR must be set — point it at storage separate from the Docker host}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER="${CONTAINER:-trackdown-postgres}"
POSTGRES_USER="${POSTGRES_USER:-trackdown}"
POSTGRES_DB="${POSTGRES_DB:-trackdown}"

timestamp="$(date +%Y-%m-%d_%H%M%S)"
target="${BACKUP_DIR}/${POSTGRES_DB}-${timestamp}.sql.gz"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
	log "❌ container ${CONTAINER} is not running — nothing to back up"
	exit 1
fi

mkdir -p "${BACKUP_DIR}"
tmp="${target}.partial"
log "📦 dumping ${POSTGRES_DB} from ${CONTAINER}"
if ! docker exec "${CONTAINER}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists | gzip > "${tmp}"; then
	log "❌ pg_dump failed"; rm -f "${tmp}"; exit 1
fi
if ! gzip -t "${tmp}"; then
	log "❌ archive failed its integrity check, discarding"; rm -f "${tmp}"; exit 1
fi
mv "${tmp}" "${target}"
log "✅ wrote ${target} ($(du -h "${target}" | cut -f1))"

size_bytes="$(stat -c %s "${target}")"
if [ "${size_bytes}" -lt 1024 ]; then
	log "⚠️  archive is only ${size_bytes} bytes — verify the database is not empty"
fi

deleted="$(find "${BACKUP_DIR}" -name "${POSTGRES_DB}-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
log "🧹 pruned ${deleted} backup(s) older than ${RETENTION_DAYS} days"
