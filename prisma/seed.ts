import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Minimal spinner — no extra dependencies required
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

class Spinner {
  private frame = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private label = ''

  /** Start spinning with the given label. Prevents a second start while running. */
  start(label: string): void {
    if (this.timer) return // already running — disabled while in progress
    this.label = label
    this.frame = 0
    process.stdout.write('\x1B[?25l') // hide cursor
    this.timer = setInterval(() => {
      const icon = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]
      process.stdout.write(`\r${icon}  ${this.label}`)
      this.frame++
    }, 80)
  }

  /** Stop the spinner and print a final status line. */
  stop(success: boolean, message: string): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const icon = success ? '✔' : '✖'
    process.stdout.write(`\r${icon}  ${message}\n`)
    process.stdout.write('\x1B[?25h') // restore cursor
  }
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

async function main() {
  const spinner = new Spinner()

  // ── Tokens ────────────────────────────────────────────────────────────────
  spinner.start('Seeding tokens…')
  const token0 = await prisma.token.upsert({
    where: { address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
    update: {},
    create: {
      address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoUri: 'https://example.com/usdc.png',
    },
  })

  const token1 = await prisma.token.upsert({
    where: { address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR' },
    update: {},
    create: {
      address: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR',
      symbol: 'XLM',
      name: 'Stellar Lumens',
      decimals: 7,
      logoUri: 'https://example.com/xlm.png',
    },
  })
  spinner.stop(true, `Tokens seeded  (${token0.symbol}, ${token1.symbol})`)

  // ── Pool ──────────────────────────────────────────────────────────────────
  spinner.start('Seeding pool…')
  const pool = await prisma.pool.upsert({
    where: { id: 'test-pool-1' },
    update: {},
    create: {
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
    },
  })
  spinner.stop(true, `Pool seeded    (${pool.id})`)

  // ── Position ──────────────────────────────────────────────────────────────
  spinner.start('Seeding position…')
  await prisma.position.upsert({
    where: { id: 'test-position-1' },
    update: {},
    create: {
      id: 'test-position-1',
      poolId: pool.id,
      ownerAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
      tokenId: '1',
      lowerTick: -60,
      upperTick: 60,
      liquidity: '1000000000000000000',
      feesCollected0: '0',
      feesCollected1: '0',
    },
  })
  spinner.stop(true, 'Position seeded (test-position-1)')

  // ── Swaps ─────────────────────────────────────────────────────────────────
  spinner.start('Seeding swaps…')
  await prisma.swap.createMany({
    data: [
      {
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
        poolId: pool.id,
        senderAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
        recipientAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
        amount0: '0',
        amount1: '10000000',
        sqrtPriceAfter: '79228162514264337593543950336',
        tickAfter: 0,
        transactionHash: 'test-tx-2',
      },
    ],
  })
  spinner.stop(true, 'Swaps seeded   (2 records)')

  // ── Price candles ─────────────────────────────────────────────────────────
  spinner.start('Seeding price candles…')
  await prisma.priceCandle.createMany({
    data: [
      {
        poolId: pool.id,
        open: '1.0',
        high: '1.05',
        low: '0.95',
        close: '1.02',
        volume: '1000000',
        timestamp: new Date(),
        interval: '1h',
      },
    ],
  })
  spinner.stop(true, 'Price candles seeded (1 record)')

  console.log('\nDatabase seeded successfully ✔')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('\nSeed failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
