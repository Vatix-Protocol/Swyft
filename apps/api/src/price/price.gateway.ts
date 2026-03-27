import {
  WebSocketGateway,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { PriceService } from './price.service';

interface IncomingMessage {
  action: 'subscribe' | 'unsubscribe';
  poolId: string;
}

@WebSocketGateway({ path: '/' })
export class PriceGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly priceService: PriceService) {}

  afterInit(server: Server) {
    server.on('connection', (client: WebSocket) => {
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
          client.send(
            JSON.stringify({ event: 'subscribed', poolId: msg.poolId }),
          );
        } else if (msg.action === 'unsubscribe') {
          this.priceService.unsubscribe(client, msg.poolId);
          client.send(
            JSON.stringify({ event: 'unsubscribed', poolId: msg.poolId }),
          );
        }
      });
    });
  }

  handleDisconnect(client: WebSocket) {
    this.priceService.removeClient(client);
  }
}
