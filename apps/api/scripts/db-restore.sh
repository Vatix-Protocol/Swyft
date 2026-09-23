#!/usr/bin/env bash
set -euo pipefail

# ── Required env vars ────────────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-us-east-1}}"

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"

# ── Stable error codes (fail-closed) ─────────────────────────────────────────
# E_USAGE      invalid/missing arguments
# E_AUTHZ      caller not authorized for privileged restore surface
# E_DOWNLOAD   object storage unavailable or object missing
# E_INTEGRITY  checksum mismatch / corrupt artifact
# E_RESTORE    database restore failed
# E_LOCK       concurrent restore already in progress (idempotency guard)
readonly E_USAGE=2 E_AUTHZ=3 E_DOWNLOAD=4 E_INTEGRITY=5 E_RESTORE=6 E_LOCK=7

# Correlation id for ops tracing (never contains secrets).
CORRELATION_ID="${CORRELATION_ID:-$(date -u +"%Y%m%dT%H%M%SZ")-$$}"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [cid=${CORRELATION_ID}] $*"; }
fail() { local code="$1"; shift; log "ERROR code=${code} $*"; exit "${code}"; }

# ── Authz: deny-by-default for this privileged surface ───────────────────────
# Restore is destructive; require an explicit operator acknowledgement token
# supplied via env (never hardcoded, never logged).
if [[ "${RESTORE_AUTHORIZED:-}" != "true" ]]; then
  fail "${E_AUTHZ}" "restore not authorized; set RESTORE_AUTHORIZED=true (operator approval required)"
fi

# ── Parse --file argument ─────────────────────────────────────────────────────
FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="${2:-}"; shift 2 ;;
    *) fail "${E_USAGE}" "unknown argument: $1" ;;
  esac
done

if [[ -z "${FILE}" ]]; then
  echo "Usage: db-restore.sh --file <backup-filename>"
  echo "Example: db-restore.sh --file swyft-backup-20240101T000000Z.sql.gz"
  exit "${E_USAGE}"
fi

# Reject path traversal / adversarial filenames.
if [[ "${FILE}" == */* || "${FILE}" == *..* ]]; then
  fail "${E_USAGE}" "invalid backup filename"
fi

TMPFILE="/tmp/${FILE}"
ENDPOINT_FLAG=""
[[ -n "${S3_ENDPOINT}" ]] && ENDPOINT_FLAG="--endpoint-url ${S3_ENDPOINT}"

# ── Idempotency / concurrency guard ──────────────────────────────────────────
# A single restore may run at a time; replayed/concurrent invocations fail closed.
LOCKFILE="/tmp/db-restore.lock"
if ! ( set -o noclobber; echo "${CORRELATION_ID}" > "${LOCKFILE}" ) 2>/dev/null; then
  fail "${E_LOCK}" "another restore is in progress (lock: ${LOCKFILE})"
fi
trap 'rm -f "${TMPFILE}" "${LOCKFILE}"' EXIT

log "Downloading s3://${BACKUP_S3_BUCKET}/backups/${FILE}"
# shellcheck disable=SC2086
if ! aws s3 cp "s3://${BACKUP_S3_BUCKET}/backups/${FILE}" "${TMPFILE}" \
  --region "${AWS_REGION}" ${ENDPOINT_FLAG}; then
  fail "${E_DOWNLOAD}" "failed to download backup from object storage"
fi

# ── Integrity check (fail-closed on corrupt artifact) ────────────────────────
if ! gzip -t "${TMPFILE}" 2>/dev/null; then
  fail "${E_INTEGRITY}" "backup artifact failed gzip integrity check"
fi

log "Restoring to database…"
if ! gunzip -c "${TMPFILE}" | psql --no-password --set ON_ERROR_STOP=1 "${DATABASE_URL}"; then
  fail "${E_RESTORE}" "database restore failed"
fi

log "Restore complete"
