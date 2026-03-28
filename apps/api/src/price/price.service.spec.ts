import { PriceService, PriceEvent } from './price.service';
import { CacheService } from '../cache/cache.service';
import Redis from 'ioredis';
import { WebSocket } from 'ws';

function mockClient(
  readyState: number = WebSocket.OPEN,
): WebSocket & { send: jest.Mock } {
  return { readyState, send: jest.fn() } as unknown as WebSocket & {
    send: jest.Mock;
  };
}

function buildMockSubscriber(): jest.Mocked<Redis> {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
      return mockSub;
    }),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    _handlers: handlers,
  } as unknown as jest.Mocked<Redis> & {
    _handlers: Record<string, (...args: unknown[]) => void>;
  };
}

let mockSub: ReturnType<typeof buildMockSubscriber>;

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(() => {
    mockSub = buildMockSubscriber();
    const mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      createSubscriber: jest.fn().mockReturnValue(mockSub),
    } as unknown as CacheService;
    service = new PriceService(mockCache);
    service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  const event: PriceEvent = {
    poolId: 'pool-1',
    currentPrice: '1.23',
    sqrtPrice: '1.109',
    tick: 100,
    liquidity: '500000',
    timestamp: Date.now(),
  };

  it('broadcasts to subscribed client', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).toHaveBeenCalledWith(
      JSON.stringify({ event: 'price', data: event }),
    );
  });

  it('does not broadcast after unsubscribe', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.unsubscribe(client, 'pool-1');
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).not.toHaveBeenCalled();
  });

  it('cleans up all pools on disconnect', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.subscribe(client, 'pool-2');
    service.removeClient(client);
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).not.toHaveBeenCalled();
  });

  it('supports multiple clients on same pool', () => {
    const c1 = mockClient();
    const c2 = mockClient();
    service.subscribe(c1, 'pool-1');
    service.subscribe(c2, 'pool-1');
    service.broadcastPrice(event);
    expect(c1.send as jest.Mock).toHaveBeenCalledTimes(1);
    expect(c2.send as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('supports one client on multiple pools', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.subscribe(client, 'pool-2');
    service.broadcastPrice(event);
    service.broadcastPrice({ ...event, poolId: 'pool-2' });
    expect(client.send as jest.Mock).toHaveBeenCalledTimes(2);
  });

  it('skips non-OPEN clients', () => {
    const client = mockClient(WebSocket.CLOSED);
    service.subscribe(client, 'pool-1');
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).not.toHaveBeenCalled();
  });

  it('subscribes to Redis channel on first client', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    expect(mockSub.subscribe).toHaveBeenCalledWith('prices:pool-1');
  });

  it('unsubscribes from Redis channel when last client leaves', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.unsubscribe(client, 'pool-1');
    expect(mockSub.unsubscribe).toHaveBeenCalledWith('prices:pool-1');
  });

  it('re-subscribes to active channels on Redis reconnect', () => {
    const c1 = mockClient();
    const c2 = mockClient();
    service.subscribe(c1, 'pool-1');
    service.subscribe(c2, 'pool-2');

    // Simulate Redis 'ready' event (reconnect)
    const sub = mockSub as unknown as {
      _handlers: Record<string, (...args: unknown[]) => void>;
    };
    sub._handlers['ready']?.();

    expect(mockSub.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('prices:pool-'),
      expect.stringContaining('prices:pool-'),
    );
  });

  describe('load test — 1000 concurrent subscribers', () => {
    it('delivers update to 1000 clients within 200ms', () => {
      const clients = Array.from({ length: 1000 }, () => mockClient());
      for (const c of clients) service.subscribe(c, 'pool-load');

      const start = Date.now();
      service.broadcastPrice({ ...event, poolId: 'pool-load' });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
      for (const c of clients) {
        expect(c.send as jest.Mock).toHaveBeenCalledTimes(1);
      }
    });
  });
});
