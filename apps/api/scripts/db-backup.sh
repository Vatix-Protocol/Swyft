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

# ── Stable error codes (fail-closed) ─────────────────────────────────────────
# E_BACKUP_* codes are stable identifiers for ops/alerting. Never leak secrets.
ERR_MISSING_DEP="E_BACKUP_MISSING_DEP"
ERR_DUMP_FAILED="E_BACKUP_DUMP_FAILED"
ERR_UPLOAD_FAILED="E_BACKUP_UPLOAD_FAILED"
ERR_VERIFY_FAILED="E_BACKUP_VERIFY_FAILED"
ERR_PRUNE_FAILED="E_BACKUP_PRUNE_FAILED"

# ── Correlation id ───────────────────────────────────────────────────────────
# Prefer an upstream-provided id (e.g. from the scheduler) for traceability.
CORRELATION_ID="${BACKUP_CORRELATION_ID:-$(date -u +"%Y%m%dT%H%M%SZ")-$$}"

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
FILENAME="swyft-backup-${TIMESTAMP}.sql.gz"
TMPFILE="/tmp/${FILENAME}"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [cid=${CORRELATION_ID}] $*"; }

# fail <code> <message> — emit a stable error code and exit non-zero (fail-closed).
fail() {
  local code="$1"; shift
  log "ERROR ${code}: $*"
  exit 1
}

# ── Dependency preflight (fail-closed on outage) ─────────────────────────────
# Verify required tooling and DB reachability BEFORE writing anything.
for bin in pg_dump gzip aws; do
  command -v "${bin}" >/dev/null 2>&1 || fail "${ERR_MISSING_DEP}" "required binary not found: ${bin}"
done

log "Starting backup → ${FILENAME}"

# ── Dump (fail-closed: abort on any dump error) ──────────────────────────────
if ! pg_dump --no-password "${DATABASE_URL}" | gzip > "${TMPFILE}"; then
  rm -f "${TMPFILE}"
  fail "${ERR_DUMP_FAILED}" "pg_dump failed; no backup produced"
fi

# Guard against a truncated/empty dump being uploaded as a valid backup.
if [[ ! -s "${TMPFILE}" ]]; then
  rm -f "${TMPFILE}"
  fail "${ERR_DUMP_FAILED}" "dump produced empty artifact"
fi

# Verify the gzip stream is intact before upload.
if ! gzip -t "${TMPFILE}"; then
  rm -f "${TMPFILE}"
  fail "${ERR_VERIFY_FAILED}" "gzip integrity check failed"
fi

log "Dump complete ($(du -sh "${TMPFILE}" | cut -f1))"

# ── Upload (fail-closed: abort if object storage is unreachable) ─────────────
ENDPOINT_FLAG=""
[[ -n "${S3_ENDPOINT}" ]] && ENDPOINT_FLAG="--endpoint-url ${S3_ENDPOINT}"

# shellcheck disable=SC2086
if ! aws s3 cp "${TMPFILE}" "s3://${BACKUP_S3_BUCKET}/backups/${FILENAME}" \
  --region "${AWS_REGION}" ${ENDPOINT_FLAG}; then
  rm -f "${TMPFILE}"
  fail "${ERR_UPLOAD_FAILED}" "upload to s3://${BACKUP_S3_BUCKET}/backups/${FILENAME} failed"
fi
log "Uploaded to s3://${BACKUP_S3_BUCKET}/backups/${FILENAME}"

# ── Prune old backups (best-effort; never fails the backup) ──────────────────
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
    if aws s3 rm "s3://${BACKUP_S3_BUCKET}/${key}" --region "${AWS_REGION}" ${ENDPOINT_FLAG}; then
      log "Deleted stale backup: ${key}"
    else
      log "WARN ${ERR_PRUNE_FAILED}: could not delete stale backup: ${key}"
    fi
  done
fi

rm -f "${TMPFILE}"
log "Backup complete"
