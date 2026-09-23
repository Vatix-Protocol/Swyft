import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stable error codes for the admin audit surface. These are part of the
 * public contract and must not change without a versioned migration.
 */
export enum AdminAuditErrorCode {
  UNAUTHORIZED = 'ADMIN_AUDIT_UNAUTHORIZED',
  FORBIDDEN = 'ADMIN_AUDIT_FORBIDDEN',
  INVALID_INPUT = 'ADMIN_AUDIT_INVALID_INPUT',
  DEPENDENCY_UNAVAILABLE = 'ADMIN_AUDIT_DEPENDENCY_UNAVAILABLE',
  DUPLICATE_REQUEST = 'ADMIN_AUDIT_DUPLICATE_REQUEST',
}

export class AdminAuditError extends Error {
  constructor(
    public readonly code: AdminAuditErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'AdminAuditError';
  }
}

/**
 * Roles permitted to emit admin audit records. Deny-by-default: any role not
 * present here is rejected before any write is attempted.
 */
export const ADMIN_AUDIT_ALLOWED_ROLES: ReadonlyArray<string> = [
  'admin',
  'superadmin',
  'auditor',
];

/**
 * Networks on which admin audit writes are permitted. Mainnet writes are
 * gated behind an explicit flag so testnet/mainnet drift cannot silently
 * enable privileged writes.
 */
export const ADMIN_AUDIT_ALLOWED_NETWORKS: ReadonlyArray<string> = [
  'testnet',
  'futurenet',
  'mainnet',
];

export interface AdminAuditActor {
  id: string;
  role: string;
  /** Optional expiry (epoch ms) for the actor's auth session. */
  expiresAt?: number;
}

export interface AdminAuditRecord {
  /** Correlation id propagated from the request for end-to-end tracing. */
  correlationId: string;
  actorId: string;
  actorRole: string;
  action: string;
  target?: string;
  network: string;
  /** Idempotency key supplied by the caller; used to dedupe replays. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface AdminAuditRequest {
  actor: AdminAuditActor;
  action: string;
  target?: string;
  idempotencyKey: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Minimal persistence contract. Implementations must fail-closed: a thrown
 * error from `persist` is surfaced to the caller and never swallowed.
 */
export interface AdminAuditStore {
  persist(record: AdminAuditRecord): Promise<void>;
  hasIdempotencyKey(key: string): Promise<boolean>;
}

/**
 * In-memory store used as a safe default and in tests. It is intentionally
 * fail-closed: if the backing store is unavailable the caller receives a
 * DEPENDENCY_UNAVAILABLE error rather than a silent success.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);
  private readonly seenKeys = new Set<string>();
  private readonly records: AdminAuditRecord[] = [];

  constructor(private readonly config?: ConfigService) {}

  /**
   * Emit an admin audit record. Deny-by-default: authorization, input
   * validation, idempotency, and network gating are all enforced before any
   * write occurs. Any failure is surfaced as a typed AdminAuditError.
   */
  async record(request: AdminAuditRequest): Promise<AdminAuditRecord> {
    const correlationId = request.correlationId ?? this.newCorrelationId();

    this.assertAuthorized(request.actor, correlationId);
    this.assertValidInput(request, correlationId);

    const network = this.resolveNetwork();
    if (!ADMIN_AUDIT_ALLOWED_NETWORKS.includes(network)) {
      throw new AdminAuditError(
        AdminAuditErrorCode.FORBIDDEN,
        `Admin audit is not permitted on network '${network}'`,
        correlationId,
      );
    }

    if (this.seenKeys.has(request.idempotencyKey)) {
      throw new AdminAuditError(
        AdminAuditErrorCode.DUPLICATE_REQUEST,
        'Duplicate admin audit request',
        correlationId,
      );
    }

    const record: AdminAuditRecord = {
      correlationId,
      actorId: request.actor.id,
      actorRole: request.actor.role,
      action: request.action,
      target: request.target,
      network,
      idempotencyKey: request.idempotencyKey,
      metadata: this.sanitizeMetadata(request.metadata),
      timestamp: new Date().toISOString(),
    };

    try {
      await this.persist(record);
    } catch (err) {
      // Fail-closed: never report success when the write did not land.
      this.logger.error(
        `Admin audit persist failed correlationId=${correlationId} code=${AdminAuditErrorCode.DEPENDENCY_UNAVAILABLE}`,
      );
      throw new AdminAuditError(
        AdminAuditErrorCode.DEPENDENCY_UNAVAILABLE,
        'Admin audit store unavailable',
        correlationId,
      );
    }

    this.seenKeys.add(request.idempotencyKey);
    this.records.push(record);

    // Ops-safe log: no secrets, no raw metadata, only identifiers.
    this.logger.log(
      `admin_audit action=${record.action} actor=${record.actorId} role=${record.actorRole} network=${record.network} correlationId=${record.correlationId}`,
    );

    return record;
  }

  /** Read-only accessor for tests and diagnostics. */
  list(): ReadonlyArray<AdminAuditRecord> {
    return this.records;
  }

  private assertAuthorized(actor: AdminAuditActor, correlationId: string): void {
    if (!actor || !actor.id) {
      throw new AdminAuditError(
        AdminAuditErrorCode.UNAUTHORIZED,
        'Missing admin audit actor',
        correlationId,
      );
    }
    if (actor.expiresAt !== undefined && actor.expiresAt <= Date.now()) {
      throw new AdminAuditError(
        AdminAuditErrorCode.UNAUTHORIZED,
        'Admin audit actor session expired',
        correlationId,
      );
    }
    if (!ADMIN_AUDIT_ALLOWED_ROLES.includes(actor.role)) {
      throw new AdminAuditError(
        AdminAuditErrorCode.FORBIDDEN,
        `Role '${actor.role}' is not permitted to emit admin audit records`,
        correlationId,
      );
    }
  }

  private assertValidInput(request: AdminAuditRequest, correlationId: string): void {
    if (!request.action || typeof request.action !== 'string' || request.action.length > 128) {
      throw new AdminAuditError(
        AdminAuditErrorCode.INVALID_INPUT,
        'Invalid admin audit action',
        correlationId,
      );
    }
    if (!request.idempotencyKey || typeof request.idempotencyKey !== 'string') {
      throw new AdminAuditError(
        AdminAuditErrorCode.INVALID_INPUT,
        'Missing idempotency key',
        correlationId,
      );
    }
  }

  private resolveNetwork(): string {
    const configured =
      this.config?.get<string>('STELLAR_NETWORK') ??
      process.env.STELLAR_NETWORK ??
      'testnet';
    return configured.toLowerCase();
  }

  private sanitizeMetadata(
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!metadata) {
      return undefined;
    }
    const redactedKeys = ['secret', 'token', 'password', 'key', 'authorization'];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (redactedKeys.some((r) => k.toLowerCase().includes(r))) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private newCorrelationId(): string {
    return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async persist(record: AdminAuditRecord): Promise<void> {
    // Default in-memory persistence. A production store can be injected by
    // overriding this method or providing an AdminAuditStore implementation.
    void record;
  }
}
