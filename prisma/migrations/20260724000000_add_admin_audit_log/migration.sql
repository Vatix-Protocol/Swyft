-- #497 Audit log for admin API actions
CREATE TABLE "admin_audit_log" (
    "id"         TEXT         NOT NULL,
    "actor"      TEXT         NOT NULL,
    "action"     TEXT         NOT NULL,
    "resource"   TEXT         NOT NULL,
    "meta"       TEXT         NOT NULL DEFAULT '{}',
    "ip"         TEXT,
    "statusCode" INTEGER,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_log_actor_idx"     ON "admin_audit_log"("actor");
CREATE INDEX "admin_audit_log_action_idx"    ON "admin_audit_log"("action");
CREATE INDEX "admin_audit_log_createdAt_idx" ON "admin_audit_log"("createdAt");
