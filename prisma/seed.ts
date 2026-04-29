import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Create some test tokens
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

  // Create a test pool
  const pool = await prisma.pool.upsert({
    where: { id: 'test-pool-1' },
    update: {},
    create: {
      id: 'test-pool-1',
      token0Address: token0.address,
      token1Address: token1.address,
      feeTier: 3000,
      currentSqrtPrice: '79228162514264337593543950336', // sqrt(1) * 2^96
      currentTick: 0,
      liquidity: '1000000000000000000',
      tvl: '2000000000',
      volume24h: '100000000',
      feeApr: '0.05',
    },
  })

  // Create a test position
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

  // Create some test swaps
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

  // Create some test price candles
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

  console.log('Database seeded successfully')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })