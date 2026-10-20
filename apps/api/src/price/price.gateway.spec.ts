import { PriceGateway } from './price.gateway';
import { PriceService } from './price.service';
import {
  WS_ERROR_CODES,
  WsAuthPolicy,
  WsPrincipal,
  wsPoolUpdatesAuthOutcomes,
} from './ws-auth-policy';

/** Inbound frames larger than this are ignored (griefing guard). */
const MAX_MESSAGE_BYTES = 4096;

interface SentFrame {
  event?: string;
  code?: string;
  poolId?: string;
}

/** Minimal fake WebSocket client capturing frames sent by the gateway. */
function createFakeClient() {
  const sent: SentFrame[] = [];
  const client = {
    readyState: 1, // WebSocket.OPEN
    send: (data: string) => {
      sent.push(JSON.parse(data) as SentFrame);
    },
    close: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
  };
  return { client, sent };
}

/** Authenticated principal used to exercise the subscribe path. */
function createPrincipal(): WsPrincipal {
  return {
    authenticated: true,
    address: '0x0000000000000000000000000000000000000001',
  } as WsPrincipal;
}

function createPolicy(maxSubscriptions: number): WsAuthPolicy {
  return {
    mode: 'required',
    maxSubscriptions,
    anonymousMaxSubscriptions: 0,
  } as WsAuthPolicy;
}

/** Build a subscribe frame padded to an exact byte length. */
function frameOfSize(bytes: number, poolId: string): Buffer {
  const base = JSON.stringify({ action: 'subscribe', poolId });
  const padding = bytes - Buffer.byteLength(base);
  if (padding < 0) {
    throw new Error(`frameOfSize(${bytes}) smaller than base frame`);
  }
  const padded = JSON.stringify({
    action: 'subscribe',
    poolId,
    pad: 'x'.repeat(padding),
  });
  const buf = Buffer.from(padded);
  // Adjust for JSON escaping of the padding if needed.
  if (buf.length === bytes) return buf;
  const delta = bytes - buf.length;
  return Buffer.from(
    JSON.stringify({
      action: 'subscribe',
      poolId,
      pad: 'x'.repeat(padding + delta),
    }),
  );
}

describe('PriceGateway MAX_MESSAGE_BYTES griefing guard', () => {
  const poolId = '0x' + 'a'.repeat(64);

  function setup(maxSubscriptions = 10) {
    const priceService = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      removeClient: jest.fn(),
      getSubscriptionCount: jest.fn().mockReturnValue(0),
      invalidatePairCache: jest.fn().mockResolvedValue(undefined),
    } as unknown as PriceService;
    const gateway = new PriceGateway(priceService);
    const { client, sent } = createFakeClient();
    const principal = createPrincipal();
    const policy = createPolicy(maxSubscriptions);
    const handle = (raw: Buffer) =>
      (
        gateway as unknown as {
          handleMessage: (
            c: unknown,
            r: Buffer,
            p: WsPrincipal,
            cid: string,
            max: number,
          ) => void;
        }
      ).handleMessage(client, raw, principal, 'cid-1', maxSubscriptions);
    return { gateway, priceService, client, sent, policy, handle };
  }

  it('processes a frame of exactly MAX_MESSAGE_BYTES', () => {
    const { priceService, sent, handle } = setup();
    handle(frameOfSize(MAX_MESSAGE_BYTES, poolId));
    expect(priceService.subscribe).toHaveBeenCalledWith(
      expect.anything(),
      poolId,
    );
    expect(sent).toContainEqual({ event: 'subscribed', poolId });
  });

  it('drops a frame of MAX_MESSAGE_BYTES + 1', () => {
    const { priceService, sent, handle } = setup();
    handle(frameOfSize(MAX_MESSAGE_BYTES + 1, poolId));
    expect(priceService.subscribe).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('rejects subscribing beyond maxSubscriptions', () => {
    const maxSubscriptions = 2;
    const { priceService, sent, handle } = setup(maxSubscriptions);
    (priceService.getSubscriptionCount as jest.Mock).mockReturnValue(
      maxSubscriptions,
    );
    handle(frameOfSize(64, poolId));
    expect(priceService.subscribe).not.toHaveBeenCalled();
    expect(sent).toContainEqual(
      expect.objectContaining({
        event: 'error',
        code: WS_ERROR_CODES.SUBSCRIPTION_LIMIT,
        poolId,
      }),
    );
  });
});

describe('PriceGateway malformed-frame handling', () => {
  const poolId = '0x' + 'a'.repeat(64);

  function setup() {
    const priceService = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      removeClient: jest.fn(),
      getSubscriptionCount: jest.fn().mockReturnValue(0),
      invalidatePairCache: jest.fn().mockResolvedValue(undefined),
    } as unknown as PriceService;
    const gateway = new PriceGateway(priceService);
    const { client, sent } = createFakeClient();
    const principal = createPrincipal();
    const handle = (raw: Buffer) =>
      (
        gateway as unknown as {
          handleMessage: (
            c: unknown,
            r: Buffer,
            p: WsPrincipal,
            cid: string,
            max: number,
          ) => void;
        }
      ).handleMessage(client, raw, principal, 'cid-1', 10);
    return { priceService, client, sent, handle };
  }

  /** Net increase of a single outcome counter around `fn`. */
  function outcomeDelta(label: string, fn: () => void): number {
    const before = wsPoolUpdatesAuthOutcomes.snapshot()[label] ?? 0;
    fn();
    const after = wsPoolUpdatesAuthOutcomes.snapshot()[label] ?? 0;
    return after - before;
  }

  it('counts oversized frames and stays silent', () => {
    const { priceService, sent, handle } = setup();
    const delta = outcomeDelta('oversized_frame', () =>
      handle(frameOfSize(MAX_MESSAGE_BYTES + 1, poolId)),
    );
    expect(delta).toBe(1);
    expect(priceService.subscribe).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('counts unparseable frames and stays silent', () => {
    const { sent, handle } = setup();
    const delta = outcomeDelta('malformed_frame', () =>
      handle(Buffer.from('not-json')),
    );
    expect(delta).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('counts non-object frames and stays silent', () => {
    const { sent, handle } = setup();
    const delta = outcomeDelta('malformed_frame', () =>
      handle(Buffer.from(JSON.stringify('just-a-string'))),
    );
    expect(delta).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('counts invalid actions and sends an INVALID_REQUEST error frame', () => {
    const { sent, handle } = setup();
    const delta = outcomeDelta('invalid_action', () =>
      handle(Buffer.from(JSON.stringify({ action: 'not-an-action', poolId }))),
    );
    expect(delta).toBe(1);
    expect(sent).toContainEqual(
      expect.objectContaining({
        event: 'error',
        code: WS_ERROR_CODES.INVALID_REQUEST,
      }),
    );
  });
});
