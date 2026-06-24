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
// Seed steps
// ---------------------------------------------------------------------------

export async function main() {
  const spinner = new Spinner();

  try {
    // ── Tokens ──────────────────────────────────────────────────────────────
    spinner.start('Seeding tokens…');
    const token0Data: Prisma.TokenCreateInput = {
      address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoUri: 'https://example.com/usdc.png',
    };

    const token0 = await prisma.token.upsert({
      where: { address: token0Data.address },
      update: {},
      create: token0Data,
    });

    const token1Data: Prisma.TokenCreateInput = {
      address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR',
      symbol: 'XLM',
      name: 'Stellar Lumens',
      decimals: 7,
      logoUri: 'https://example.com/xlm.png',
    };

    const token1 = await prisma.token.upsert({
      where: { address: token1Data.address },
      update: {},
      create: token1Data,
    });
    spinner.stop(true, `Tokens seeded  (${token0.symbol}, ${token1.symbol})`);

    // ── Pool ────────────────────────────────────────────────────────────────
    spinner.start('Seeding pool…');
    const poolData: Prisma.PoolCreateInput = {
      id: 'test-pool-1',
      token0Address: token0.address,
      token1Address: token1.address,
      feeTier: 3000,
      currentSqrtPrice: '79228162514264337593543950336',
      currentTick: 0,
      liquidity: '1000000000000000000',
      tvl: '2000000000',
      volume24h: '100000000',
      feeApr: '0.05',
    };

    const pool = await prisma.pool.upsert({
      where: { id: poolData.id },
      update: {},
      create: poolData,
    });
    spinner.stop(true, `Pool seeded    (${pool.id})`);

    // ── Position ────────────────────────────────────────────────────────────
    spinner.start('Seeding position…');
    const positionData: Prisma.PositionCreateInput = {
      id: 'test-position-1',
      poolId: pool.id,
      ownerAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
      tokenId: '1',
      lowerTick: -60,
      upperTick: 60,
      liquidity: '1000000000000000000',
      feesCollected0: '0',
      feesCollected1: '0',
    };

    await prisma.position.upsert({
      where: { id: positionData.id },
      update: {},
      create: positionData,
    });
    spinner.stop(true, 'Position seeded (test-position-1)');

    // ── Swaps ────────────────────────────────────────────────────────────────
    spinner.start('Seeding swaps…');
    const swapData: Prisma.SwapCreateManyInput[] = [
      {
        eventId: 'seed-swap-event-1',
        poolId: pool.id,
        senderAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
        recipientAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
        amount0: '1000000',
        amount1: '0',
        sqrtPriceAfter: '79228162514264337593543950336',
        tickAfter: 0,
        transactionHash: 'test-tx-1',
      },
      {
        eventId: 'seed-swap-event-2',
        poolId: pool.id,
        senderAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
        recipientAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
        amount0: '0',
        amount1: '10000000',
        sqrtPriceAfter: '79228162514264337593543950336',
        tickAfter: 0,
        transactionHash: 'test-tx-2',
      },
    ];

    await prisma.swap.createMany({
      data: swapData,
    });
    spinner.stop(true, 'Swaps seeded   (2 records)');

    // ── Price candles ────────────────────────────────────────────────────────
    spinner.start('Seeding price candles…');
    const priceCandleData: Prisma.PriceCandleCreateManyInput[] = [
      {
        poolId: pool.id,
        open: 1.0,
        high: 1.05,
        low: 0.95,
        close: 1.02,
        volumeUsd: 1000000.0,
        periodStart: new Date(),
        interval: '1h',
      },
    ];

    await prisma.priceCandle.createMany({
      data: priceCandleData,
    });
    spinner.stop(true, 'Price candles seeded (1 record)');

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
