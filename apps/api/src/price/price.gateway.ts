import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { IncomingMessage as HttpIncomingMessage } from 'http';
import { PriceService } from './price.service';
import {
  authenticateWsHandshake,
  isActionAllowed,
  isValidPoolId,
  recordHandshakeOutcome,
  resolveWsAuthPolicy,
  subscriptionLimitFor,
  WS_CLOSE_UNAUTHORIZED,
  WS_ERROR_CODES,
  WsAction,
  WsAuthPolicy,
  WsErrorCode,
  wsPoolUpdatesAuthOutcomes,
  WsPrincipal,
} from './ws-auth-policy';

interface IncomingMessage {
  action?: unknown;
  poolId?: unknown;
  tokenA?: unknown;
  tokenB?: unknown;
}

const ACTIONS: ReadonlySet<string> = new Set<WsAction>([
  'subscribe',
  'unsubscribe',
  'swap',
]);

/** Inbound frames larger than this are ignored (griefing guard). */
const MAX_MESSAGE_BYTES = 4096;

/**
 * Pool price updates over WebSocket.
 *
 * Authn follows the pool-updates policy in ./ws-auth-policy.ts (#1027):
 * `required` by default, `optional` (anonymous read-only) only when an
 * operator opts in. See docs/WEBSOCKET_RECONNECT.md.
 */
@WebSocketGateway({ path: '/price' })
export class PriceGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(PriceGateway.name);
  @WebSocketServer()
  server!: Server;

  constructor(private readonly priceService: PriceService) {}

  afterInit(server: Server) {
    const policy = resolveWsAuthPolicy();
    if (policy.downgradeReason) {
      this.logger.warn(
        `WS_POOL_UPDATES_AUTH_MODE refused (${policy.downgradeReason}); enforcing mode=required`,
      );
    }
    this.logger.log(
      `price WebSocket auth mode=${policy.mode} maxSubs=${policy.maxSubscriptions} anonMaxSubs=${policy.anonymousMaxSubscriptions}`,
    );
    server.on('connection', (client: WebSocket, request: HttpIncomingMessage) =>
      this.onClientConnection(client, request, policy),
    );
  }

  // Not named handleConnection: Nest would also invoke that hook itself.
  onClientConnection(
    client: WebSocket,
    request: HttpIncomingMessage,
    policy: WsAuthPolicy = resolveWsAuthPolicy(),
  ): void {
    const auth = authenticateWsHandshake(request, policy);
    recordHandshakeOutcome(auth);
    if (!auth.ok) {
      this.logger.warn(
        `[${auth.correlationId}] price WebSocket rejected code=${auth.code}`,
      );
      this.send(client, {
        event: 'error',
        code: auth.code,
        message: auth.message,
        correlationId: auth.correlationId,
      });
      client.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized');
      return;
    }

    const { principal, correlationId } = auth;
    const maxSubscriptions = subscriptionLimitFor(principal, policy);

    const cleanup = () => this.priceService.removeClient(client);
    client.once('close', cleanup);
    client.once('error', cleanup);
    client.on('message', (raw: Buffer) =>
      this.handleMessage(
        client,
        raw,
        principal,
        correlationId,
        maxSubscriptions,
      ),
    );
  }

  private handleMessage(
    client: WebSocket,
    raw: Buffer,
    principal: WsPrincipal,
    correlationId: string,
    maxSubscriptions: number,
  ): void {
    if (raw.length > MAX_MESSAGE_BYTES) return;

    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw.toString()) as IncomingMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    const reject = (code: WsErrorCode, message: string, poolId?: string) =>
      this.send(client, {
        event: 'error',
        code,
        message,
        correlationId,
        ...(poolId ? { poolId } : {}),
      });

    if (typeof msg.action !== 'string' || !ACTIONS.has(msg.action)) return;
    const action = msg.action as WsAction;

    if (!isValidPoolId(msg.poolId)) {
      reject(WS_ERROR_CODES.INVALID_REQUEST, 'Invalid poolId');
      return;
    }
    const poolId = msg.poolId;

    if (!isActionAllowed(principal, action)) {
      wsPoolUpdatesAuthOutcomes.inc('forbidden_action');
      reject(
        WS_ERROR_CODES.FORBIDDEN,
        `Action "${action}" requires an authenticated wallet`,
        poolId,
      );
      return;
    }

    if (action === 'subscribe') {
      const currentCount = this.priceService.getSubscriptionCount(client);
      if (currentCount >= maxSubscriptions) {
        wsPoolUpdatesAuthOutcomes.inc('subscription_limit');
        reject(
          WS_ERROR_CODES.SUBSCRIPTION_LIMIT,
          `Subscription limit reached (${maxSubscriptions} max)`,
          poolId,
        );
        return;
      }
      // Idempotent: re-subscribing to a held pool is a no-op server-side.
      this.priceService.subscribe(client, poolId);
      this.send(client, { event: 'subscribed', poolId });
    } else if (action === 'unsubscribe') {
      this.priceService.unsubscribe(client, poolId);
      this.send(client, { event: 'unsubscribed', poolId });
    } else if (
      action === 'swap' &&
      typeof msg.tokenA === 'string' &&
      typeof msg.tokenB === 'string'
    ) {
      void this.priceService
        .invalidatePairCache(msg.tokenA, msg.tokenB)
        .catch((error: unknown) =>
          this.logger.warn(
            `[${correlationId}] Price cache invalidation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
    }
  }

  handleDisconnect(client: WebSocket) {
    this.priceService.removeClient(client);
  }

  private send(client: WebSocket, payload: object): void {
    if (client.readyState !== WebSocket.OPEN) return;
    try {
      client.send(JSON.stringify(payload));
    } catch (error) {
      this.priceService.removeClient(client);
      this.logger.warn(
        `WebSocket send failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
