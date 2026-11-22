ALTER TABLE "admin_audit_log"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "admin_audit_log_idempotencyKey_key"
ON "admin_audit_log"("idempotencyKey");
