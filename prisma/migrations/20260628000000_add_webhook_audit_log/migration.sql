-- #405 CRUD audit log for webhook changes
CREATE TABLE "webhook_audit_log" (
    "id"          TEXT         NOT NULL,
    "webhookId"   TEXT         NOT NULL,
    "action"      TEXT         NOT NULL,
    "ownerWallet" TEXT         NOT NULL,
    "meta"        TEXT         NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_audit_log_webhookId_idx"   ON "webhook_audit_log"("webhookId");
CREATE INDEX "webhook_audit_log_ownerWallet_idx" ON "webhook_audit_log"("ownerWallet");
