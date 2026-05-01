#!/usr/bin/env bash
set -euo pipefail

# ── Required env vars ────────────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-us-east-1}}"

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"   # optional — set for R2/MinIO
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
FILENAME="swyft-backup-${TIMESTAMP}.sql.gz"
TMPFILE="/tmp/${FILENAME}"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

log "Starting backup → ${FILENAME}"

# ── Dump ─────────────────────────────────────────────────────────────────────
pg_dump --no-password "${DATABASE_URL}" | gzip > "${TMPFILE}"
log "Dump complete ($(du -sh "${TMPFILE}" | cut -f1))"

# ── Upload ───────────────────────────────────────────────────────────────────
ENDPOINT_FLAG=""
[[ -n "${S3_ENDPOINT}" ]] && ENDPOINT_FLAG="--endpoint-url ${S3_ENDPOINT}"

# shellcheck disable=SC2086
aws s3 cp "${TMPFILE}" "s3://${BACKUP_S3_BUCKET}/backups/${FILENAME}" \
  --region "${AWS_REGION}" ${ENDPOINT_FLAG}
log "Uploaded to s3://${BACKUP_S3_BUCKET}/backups/${FILENAME}"

# ── Prune old backups ────────────────────────────────────────────────────────
CUTOFF=$(date -u -d "${RETAIN_DAYS} days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
  || date -u -v-"${RETAIN_DAYS}"d +"%Y-%m-%dT%H:%M:%SZ")  # macOS fallback

# shellcheck disable=SC2086
STALE=$(aws s3api list-objects-v2 \
  --bucket "${BACKUP_S3_BUCKET}" \
  --prefix "backups/" \
  --query "Contents[?LastModified<='${CUTOFF}'].Key" \
  --output text \
  --region "${AWS_REGION}" ${ENDPOINT_FLAG} 2>/dev/null || true)

if [[ -n "${STALE}" ]]; then
  for key in ${STALE}; do
    # shellcheck disable=SC2086
    aws s3 rm "s3://${BACKUP_S3_BUCKET}/${key}" --region "${AWS_REGION}" ${ENDPOINT_FLAG}
    log "Deleted stale backup: ${key}"
  done
fi

rm -f "${TMPFILE}"
log "Backup complete"
