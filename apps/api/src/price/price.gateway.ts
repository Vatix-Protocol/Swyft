import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { verify, VerifyOptions } from 'jsonwebtoken';
import { Server, WebSocket } from 'ws';
import { IncomingMessage as HttpIncomingMessage } from 'http';
import { PriceService } from './price.service';

interface IncomingMessage {
  action: 'subscribe' | 'unsubscribe' | 'swap';
  poolId: string;
  tokenA?: string;
  tokenB?: string;
}

interface JwtPayload {
  sub?: string;
  walletAddress?: string;
  wallet?: string;
  address?: string;
}

/**
 * Maximum number of pool subscriptions a single WebSocket connection may
 * hold at once. Prevents a single client from subscribing to every pool and
 * exhausting server/Redis resources. Configurable via
 * PRICE_WS_MAX_SUBSCRIPTIONS_PER_CLIENT (default: 50).
 */
const DEFAULT_MAX_SUBSCRIPTIONS_PER_CLIENT = 50;

function getMaxSubscriptionsPerClient(): number {
  const raw = process.env.PRICE_WS_MAX_SUBSCRIPTIONS_PER_CLIENT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_SUBSCRIPTIONS_PER_CLIENT;
}

@WebSocketGateway({ path: '/price' })
export class PriceGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(PriceGateway.name);
  @WebSocketServer()
  server!: Server;

  constructor(private readonly priceService: PriceService) {}

  /**
   * Verifies the JWT carried by the client (as a `token` query param, since
   * browsers cannot set custom headers on a WebSocket handshake). Returns
   * the authenticated wallet address, or null if the token is missing or
   * invalid. In production, a missing/invalid JWT_SECRET or token always
   * fails closed (connection rejected) — there is no anonymous fallback.
   */
  private authenticate(request: HttpIncomingMessage): string | null {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      this.logger.warn(
        'JWT_SECRET is not configured; rejecting price WebSocket connection',
      );
      return null;
    }

    const url = new URL(request.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) return null;

    const options: VerifyOptions = {};
    if (process.env.JWT_ISSUER) options.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) options.audience = process.env.JWT_AUDIENCE;

    try {
      const payload = verify(token, secret, options) as JwtPayload;
      const walletAddress =
        payload.walletAddress ??
        payload.wallet ??
        payload.address ??
        payload.sub;
      return typeof walletAddress === 'string' && walletAddress
        ? walletAddress
        : null;
    } catch {
      return null;
    }
  }

  afterInit(server: Server) {
    server.on(
      'connection',
      (client: WebSocket, request: HttpIncomingMessage) => {
        const walletAddress = this.authenticate(request);
        if (!walletAddress) {
          this.send(client, {
            event: 'error',
            message: 'Unauthorized: missing or invalid token',
          });
          client.close(4401, 'Unauthorized');
          return;
        }

        const maxSubscriptions = getMaxSubscriptionsPerClient();

        const cleanup = () => this.priceService.removeClient(client);
        client.once('close', cleanup);
        client.once('error', cleanup);
        client.on('message', (raw: Buffer) => {
          let msg: IncomingMessage;
          try {
            msg = JSON.parse(raw.toString()) as IncomingMessage;
          } catch {
            return;
          }

          if (!msg.poolId) return;

          if (msg.action === 'subscribe') {
            const currentCount = this.priceService.getSubscriptionCount(client);
            if (currentCount >= maxSubscriptions) {
              this.send(client, {
                event: 'error',
                message: `Subscription limit reached (${maxSubscriptions} max)`,
                poolId: msg.poolId,
              });
              return;
            }
            this.priceService.subscribe(client, msg.poolId);
            this.send(client, { event: 'subscribed', poolId: msg.poolId });
          } else if (msg.action === 'unsubscribe') {
            this.priceService.unsubscribe(client, msg.poolId);
            this.send(client, { event: 'unsubscribed', poolId: msg.poolId });
          } else if (msg.action === 'swap' && msg.tokenA && msg.tokenB) {
            void this.priceService
              .invalidatePairCache(msg.tokenA, msg.tokenB)
              .catch((error: unknown) =>
                this.logger.warn(
                  `Price cache invalidation failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                ),
              );
          }
        });
      },
    );
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
