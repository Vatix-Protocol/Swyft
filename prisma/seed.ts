import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Minimal spinner — no extra dependencies required
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private label = '';

  /** Start spinning with the given label. Prevents a second start while running. */
  start(label: string): void {
    if (this.timer) return; // already running — disabled while in progress
    this.label = label;
    this.frame = 0;
    process.stdout.write('\x1B[?25l'); // hide cursor
    this.timer = setInterval(() => {
      const icon = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      process.stdout.write(`\r${icon}  ${this.label}`);
      this.frame++;
    }, 80);
  }

  /** Stop the spinner and print a final status line. */
  stop(success: boolean, message: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const icon = success ? '✔' : '✖';
    process.stdout.write(`\r${icon}  ${message}\n`);
    process.stdout.write('\x1B[?25h'); // restore cursor
  }
}

// ---------------------------------------------------------------------------
// Deterministic fixture (fixtures/e2e-seed.json)
// ---------------------------------------------------------------------------

/**
 * Shape of fixtures/e2e-seed.json. The file is validated in CI by
 * `pnpm fixtures:check` (scripts/fixtures.js); see fixtures/README.md.
 */
export interface E2eSeedFixture {
  version: 1;
  network: 'testnet';
  clock: { now: string };
  tokens: Array<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoUri?: string;
  }>;
  pools: Array<{
    id: string;
    token0Address: string;
    token1Address: string;
    feeTier: number;
    currentSqrtPrice: string;
    currentTick: number;
    liquidity: string;
    tvl: string;
    volume24h: string;
    feeApr: string;
    createdAt: string;
  }>;
  positions: Array<{
    id: string;
    poolId: string;
    ownerAddress: string;
    tokenId: string;
    lowerTick: number;
    upperTick: number;
    liquidity: string;
    feesCollected0: string;
    feesCollected1: string;
    createdAt: string;
  }>;
  swaps: Array<{
    eventId: string;
    poolId: string;
    senderAddress: string;
    recipientAddress: string;
    amount0: string;
    amount1: string;
    sqrtPriceAfter: string;
    tickAfter: number;
    transactionHash: string;
    timestamp: string;
  }>;
  priceCandles: Array<{
    poolId: string;
    interval: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volumeUsd: number;
    periodStart: string;
  }>;
}

export const E2E_SEED_PATH = path.resolve(__dirname, '../fixtures/e2e-seed.json');

export function loadE2eSeedFixture(file: string = E2E_SEED_PATH): E2eSeedFixture {
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8')) as E2eSeedFixture;
  if (fixture.version !== 1 || fixture.network !== 'testnet') {
    throw new Error(
      `SEED_FIXTURE_INVALID: ${file} must be version 1 on testnet (run \`pnpm fixtures:check\`)`
    );
  }
  return fixture;
}

/**
 * Kill-switch: the demo seed writes fake pools/positions/swaps, so it must never
 * run against a production or mainnet database. Deny-by-default for those envs.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = (env.NODE_ENV ?? '').toLowerCase();
  const network = (env.STELLAR_NETWORK ?? '').toLowerCase();
  if (nodeEnv === 'production' || network === 'mainnet' || network === 'public') {
    throw new Error(
      `SEED_REFUSED: refusing to seed demo fixtures (NODE_ENV=${nodeEnv || 'unset'}, ` +
        `STELLAR_NETWORK=${network || 'unset'}). The seed is for local/testnet/e2e databases only.`
    );
  }
}

// Deterministic seed data — all values are fixed so re-runs are idempotent.
//
// Pool:    test-pool-1
// Token0:  USDC  GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
// Token1:  XLM   GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR
// ---------------------------------------------------------------------------

const DEMO_OWNER = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const SQRT_PRICE = '79228162514264337593543950336'; // price = 1.0 (Q64.96)
const DEMO_CANDLE_START = new Date('2026-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

export async function main() {
  const spinner = new Spinner();

  try {
    assertSeedAllowed();
    const fixture = loadE2eSeedFixture();

    // ── Tokens ──────────────────────────────────────────────────────────────
    spinner.start('Seeding tokens…');
    const tokens = [];
    for (const tokenData of fixture.tokens) {
      const data: Prisma.TokenCreateInput = { ...tokenData };
      tokens.push(
        await prisma.token.upsert({
          where: { address: data.address },
          update: {},
          create: data,
        })
      );
    }
    spinner.stop(true, `Tokens seeded  (${tokens.map((t) => t.symbol).join(', ')})`);

    // ── Pool ────────────────────────────────────────────────────────────────
    spinner.start('Seeding pool…');
    const pools = [];
    for (const { createdAt, ...rest } of fixture.pools) {
      const poolData: Prisma.PoolCreateInput = { ...rest, createdAt: new Date(createdAt) };
      pools.push(
        await prisma.pool.upsert({
          where: { id: poolData.id },
          update: {},
          create: poolData,
        })
      );
    }
    spinner.stop(true, `Pool seeded    (${pools.map((p) => p.id).join(', ')})`);

    // ── Position ────────────────────────────────────────────────────────────
    spinner.start('Seeding position…');
    for (const { createdAt, ...rest } of fixture.positions) {
      // Unchecked input: poolId is set directly rather than via a relation connect.
      const positionData: Prisma.PositionUncheckedCreateInput = {
        ...rest,
        createdAt: new Date(createdAt),
      };

      await prisma.position.upsert({
        where: { id: positionData.id },
        update: {},
        create: positionData,
      });
    }
    spinner.stop(true, `Position seeded (${fixture.positions.map((p) => p.id).join(', ')})`);

    // ── Swaps ────────────────────────────────────────────────────────────────
    // Use upsert on eventId (unique) so re-runs are fully idempotent.
    spinner.start('Seeding swaps…');
    // eventId is the idempotency key; skipDuplicates make

      await prisma.position.upsert({
        where: { id: positionData.id },
        update: {},
        create: positionData,
      });
    }
    spinner.stop(true, `Position seeded (${fixture.positions.map((p) => p.id).join(', ')})`);

    // ── Swaps ────────────────────────────────────────────────────────────────
    // Use upsert on eventId (unique) so re-runs are fully idempotent.
    spinner.start('Seeding swaps…');
    // eventId is the idempotency key; upsert makes re-runs a no-op.
    const swapSeeds = fixture.swaps.map(({ timestamp, ...rest }) => ({
      ...rest,
      timestamp: new Date(timestamp),
    }));

    for (const swap of swapSeeds) {
      await prisma.swap.upsert({
        where: { eventId: swap.eventId },
        update: {},
        create: swap,
      });
    }
    spinner.stop(true, `Swaps seeded   (${swapSeeds.length} records)`);

    // ── Price candles ────────────────────────────────────────────────────────
    // Upsert on (poolId, interval, periodStart) composite key so re-runs are
    // idempotent. createMany + skipDuplicates only guards against the same
    // batch; upsert is safe across separate seed invocations.
    spinner.start('Seeding price candles…');
    const candleSeeds = fixture.priceCandles.map(
      ({ periodStart, ...rest }) => ({
        ...rest,
        poolId: pool.id,
        periodStart: new Date(periodStart),
      })
    );

    for (const candle of candleSeeds) {
      await prisma.priceCandle.upsert({
        where: {
          poolId_interval_periodStart: {
            poolId: candle.poolId,
            interval: candle.interval,
            periodStart: candle.periodStart,
          },
        },
        update: {},
        create: candle,
      });
    }
    spinner.stop(true, `Price candles seeded (${candleSeeds.length} record)`);

    console.log('\nDatabase seeded successfully ✔');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\nSeed failed:', e);
    process.exit(1);
  });
}
