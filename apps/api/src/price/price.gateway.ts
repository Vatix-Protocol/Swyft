import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { PriceService } from './price.service';

interface IncomingMessage {
  action: 'subscribe' | 'unsubscribe' | 'swap';
  poolId: string;
  tokenA?: string;
  tokenB?: string;
}

@WebSocketGateway({ path: '/price' })
export class PriceGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(PriceGateway.name);
  @WebSocketServer()
  server!: Server;

  constructor(private readonly priceService: PriceService) {}

  afterInit(server: Server) {
    server.on('connection', (client: WebSocket) => {
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
    });
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
