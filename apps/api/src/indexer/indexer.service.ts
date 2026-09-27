import { Injectable, Logger } from '@nestjs/common';

/**
 * Stable error codes for the swap/mint/burn indexing money path.
 * Consumers (API, ops dashboards) can branch on these without parsing messages.
 */
export enum IndexerErrorCode {
  INVALID_EVENT = 'INDEXER_INVALID_EVENT',
  UNSUPPORTED_EVENT = 'INDEXER_UNSUPPORTED_EVENT',
  UNAUTHORIZED = 'INDEXER_UNAUTHORIZED',
  DEPENDENCY_UNAVAILABLE = 'INDEXER_DEPENDENCY_UNAVAILABLE',
  DUPLICATE_EVENT = 'INDEXER_DUPLICATE_EVENT',
}

/**
 * Typed domain objects produced by the indexer. The server/contract remains the
 * source of truth for balances, swaps and admin; these are derived projections.
 */
export type SwapEventKind = 'swap' | 'mint' | 'burn';

export interface IndexedEventBase {
  /** Deterministic idempotency key: chain + tx hash + event index. */
  readonly id: string;
  readonly kind: SwapEventKind;
  readonly correlationId: string;
  readonly ledger: number;
  readonly txHash: string;
  readonly contractId: string;
  readonly timestamp: number;
}

export interface SwapEvent extends IndexedEventBase {
  readonly kind: 'swap';
  readonly sender: string;
  readonly recipient: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
}

export interface MintEvent extends IndexedEventBase {
  readonly kind: 'mint';
  readonly recipient: string;
  readonly amount: string;
  readonly token: string;
}

export interface BurnEvent extends IndexedEventBase {
  readonly kind: 'burn';
  readonly sender: string;
  readonly amount: string;
  readonly token: string;
}

export type IndexedEvent = SwapEvent | MintEvent | BurnEvent;

/** Raw event as delivered by the indexer event stream (untrusted input). */
export interface RawIndexerEvent {
  readonly ledger?: unknown;
  readonly txHash?: unknown;
  readonly eventIndex?: unknown;
  readonly contractId?: unknown;
  readonly timestamp?: unknown;
  readonly topic?: unknown;
  readonly value?: unknown;
}

/** Minimal sink the indexer writes parsed events to (DB/queue). */
export interface IndexedEventSink {
  /** Must be idempotent on `event.id`; throws on dependency outage. */
  persist(event: IndexedEvent): Promise<void>;
  /** Returns true when the event id was already persisted. */
  has(eventId: string): Promise<boolean>;
}

/**
 * Authorization policy for indexer entrypoints. Deny-by-default: only callers
 * presenting a trusted internal role may drive the money path.
 */
export interface IndexerAuthContext {
  readonly role?: string;
  readonly correlationId?: string;
}

const TRUSTED_ROLES = new Set(['indexer', 'admin']);

/**
 * Ops-safe metrics hook. Implementations must never receive secrets or raw
 * payloads — only counts, kinds and error codes.
 */
export interface IndexerMetrics {
  onEventIndexed(kind: SwapEventKind): void;
  onEventRejected(code: IndexerErrorCode): void;
  onDependencyFailure(code: IndexerErrorCode): void;
}

const noopMetrics: IndexerMetrics = {
  onEventIndexed: () => undefined,
  onEventRejected: () => undefined,
  onDependencyFailure: () => undefined,
};

/**
 * Typed error carrying a stable code and correlation id for observability.
 */
export class IndexerError extends Error {
  constructor(
    readonly code: IndexerErrorCode,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = 'IndexerError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Parses swap/mint/burn events from the indexer event stream into typed domain
 * objects. Fail-closed: malformed or unauthorized input is rejected, and any
 * dependency outage aborts the write without leaving partial state.
 */
@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    private readonly sink: IndexedEventSink,
    private readonly metrics: IndexerMetrics = noopMetrics,
  ) {}

  /**
   * Entrypoint for a single raw event. Deny-by-default authz, idempotent on the
   * derived event id, and fail-closed on dependency outages.
   */
  async ingest(
    raw: RawIndexerEvent,
    auth: IndexerAuthContext,
  ): Promise<IndexedEvent> {
    const correlationId = isNonEmptyString(auth?.correlationId)
      ? auth.correlationId
      : 'indexer-unknown';

    if (!auth || !auth.role || !TRUSTED_ROLES.has(auth.role)) {
      this.metrics.onEventRejected(IndexerErrorCode.UNAUTHORIZED);
      this.logger.warn(
        `indexer.ingest rejected code=${IndexerErrorCode.UNAUTHORIZED} correlationId=${correlationId}`,
      );
      throw new IndexerError(
        IndexerErrorCode.UNAUTHORIZED,
        'caller is not authorized to drive the indexer money path',
        correlationId,
      );
    }

    const event = this.parse(raw, correlationId);

    // Idempotency: replay/concurrent delivery of the same event is a no-op.
    let alreadyPersisted: boolean;
    try {
      alreadyPersisted = await this.sink.has(event.id);
    } catch (err) {
      this.metrics.onDependencyFailure(IndexerErrorCode.DEPENDENCY_UNAVAILABLE);
      this.logger.error(
        `indexer.ingest dependency failure code=${IndexerErrorCode.DEPENDENCY_UNAVAILABLE} correlationId=${correlationId}`,
      );
      throw new IndexerError(
        IndexerErrorCode.DEPENDENCY_UNAVAILABLE,
        'indexer sink unavailable while checking idempotency',
        correlationId,
      );
    }

    if (alreadyPersisted) {
      this.metrics.onEventRejected(IndexerErrorCode.DUPLICATE_EVENT);
      this.logger.log(
        `indexer.ingest duplicate code=${IndexerErrorCode.DUPLICATE_EVENT} id=${event.id} correlationId=${correlationId}`,
      );
      return event;
    }

    try {
      await this.sink.persist(event);
    } catch (err) {
      this.metrics.onDependencyFailure(IndexerErrorCode.DEPENDENCY_UNAVAILABLE);
      this.logger.error(
        `indexer.ingest persist failure code=${IndexerErrorCode.DEPENDENCY_UNAVAILABLE} id=${event.id} correlationId=${correlationId}`,
      );
      throw new IndexerError(
        IndexerErrorCode.DEPENDENCY_UNAVAILABLE,
        'indexer sink unavailable while persisting event',
        correlationId,
      );
    }

    this.metrics.onEventIndexed(event.kind);
    this.logger.log(
      `indexer.ingest ok kind=${event.kind} id=${event.id} correlationId=${correlationId}`,
    );
    return event;
  }

  /**
   * Parses a raw event into a typed domain object. Pure and side-effect free so
   * it can be unit tested against adversarial input.
   */
  parse(raw: RawIndexerEvent, correlationId: string): IndexedEvent {
    if (!raw || typeof raw !== 'object') {
      throw this.invalid('event payload must be an object', correlationId);
    }

    const kind = this.readKind(raw.topic, correlationId);
    const ledger = raw.ledger;
    const txHash = raw.txHash;
    const eventIndex = raw.eventIndex;
    const contractId = raw.contractId;
    const timestamp = raw.timestamp;

    if (!isFiniteNumber(ledger) || ledger < 0) {
      throw this.invalid('ledger must be a non-negative number', correlationId);
    }
    if (!isNonEmptyString(txHash)) {
      throw this.invalid('txHash must be a non-empty string', correlationId);
    }
    if (!isFiniteNumber(eventIndex) || eventIndex < 0) {
      throw this.invalid('eventIndex must be a non-negative number', correlationId);
    }
    if (!isNonEmptyString(contractId)) {
      throw this.invalid('contractId must be a non-empty string', correlationId);
    }
    if (!isFiniteNumber(timestamp) || timestamp < 0) {
      throw this.invalid('timestamp must be a non-negative number', correlationId);
    }

    const id = `${contractId}:${txHash}:${eventIndex}`;
    const base = {
      id,
      correlationId,
      ledger,
      txHash,
      contractId,
      timestamp,
    } as const;

    const value = raw.value;
    if (!value || typeof value !== 'object') {
      throw this.invalid('event value must be an object', correlationId);
    }
    const v = value as Record<string, unknown>;

    switch (kind) {
      case 'swap': {
        const sender = v.sender;
        const recipient = v.recipient;
        const amountIn = v.amountIn;
        const amountOut = v.amountOut;
        const tokenIn = v.tokenIn;
        const tokenOut = v.tokenOut;
        if (
          !isNonEmptyString(sender) ||
          !isNonEmptyString(recipient) ||
          !isNonEmptyString(amountIn) ||
          !isNonEmptyString(amountOut) ||
          !isNonEmptyString(tokenIn) ||
          !isNonEmptyString(tokenOut)
        ) {
          throw this.invalid('swap event missing required fields', correlationId);
        }
        return {
          ...base,
          kind: 'swap',
          sender,
          recipient,
          amountIn,
          amountOut,
          tokenIn,
          tokenOut,
        };
      }
      case 'mint': {
        const recipient = v.recipient;
        const amount = v.amount;
        const token = v.token;
        if (
          !isNonEmptyString(recipient) ||
          !isNonEmptyString(amount) ||
          !isNonEmptyString(token)
        ) {
          throw this.invalid('mint event missing required fields', correlationId);
        }
        return { ...base, kind: 'mint', recipient, amount, token };
      }
      case 'burn': {
        const sender = v.sender;
        const amount = v.amount;
        const token = v.token;
        if (
          !isNonEmptyString(sender) ||
          !isNonEmptyString(amount) ||
          !isNonEmptyString(token)
        ) {
          throw this.invalid('burn event missing required fields', correlationId);
        }
        return { ...base, kind: 'burn', sender, amount, token };
      }
      default: {
        throw new IndexerError(
          IndexerErrorCode.UNSUPPORTED_EVENT,
          `unsupported event kind: ${String(kind)}`,
          correlationId,
        );
      }
    }
  }

  private readKind(topic: unknown, correlationId: string): SwapEventKind {
    const raw = Array.isArray(topic) ? topic[0] : topic;
    if (!isNonEmptyString(raw)) {
      throw this.invalid('event topic must be a non-empty string', correlationId);
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'swap' || normalized === 'mint' || normalized === 'burn') {
      return normalized;
    }
    throw new IndexerError(
      IndexerErrorCode.UNSUPPORTED_EVENT,
      `unsupported event topic: ${normalized}`,
      correlationId,
    );
  }

  private invalid(message: string, correlationId: string): IndexerError {
    this.metrics.onEventRejected(IndexerErrorCode.INVALID_EVENT);
    return new IndexerError(IndexerErrorCode.INVALID_EVENT, message, correlationId);
  }
}
