#!/usr/bin/env bash
set -euo pipefail

# ── Required env vars ────────────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-us-east-1}}"

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"

# ── Parse --file argument ─────────────────────────────────────────────────────
FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "${FILE}" ]]; then
  echo "Usage: db-restore.sh --file <backup-filename>"
  echo "Example: db-restore.sh --file swyft-backup-20240101T000000Z.sql.gz"
  exit 1
fi

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

TMPFILE="/tmp/${FILE}"
ENDPOINT_FLAG=""
[[ -n "${S3_ENDPOINT}" ]] && ENDPOINT_FLAG="--endpoint-url ${S3_ENDPOINT}"

log "Downloading s3://${BACKUP_S3_BUCKET}/backups/${FILE}"
# shellcheck disable=SC2086
aws s3 cp "s3://${BACKUP_S3_BUCKET}/backups/${FILE}" "${TMPFILE}" \
  --region "${AWS_REGION}" ${ENDPOINT_FLAG}

log "Restoring to database…"
gunzip -c "${TMPFILE}" | psql --no-password "${DATABASE_URL}"

rm -f "${TMPFILE}"
log "Restore complete"
