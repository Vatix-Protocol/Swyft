import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job, QueueEvents } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import {
  QUEUE_NAMES,
  makeQueueOptions,
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
  FeesCollectedJobData,
} from './queues';

@Injectable()
export class IndexerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerWorker.name);
  private readonly prisma = new PrismaClient();
  private readonly workers: Worker[] = [];
  private readonly queueEvents: QueueEvents[] = [];

  onModuleInit() {
    const connection = makeQueueOptions().connection;

    this.workers.push(
      this.makeWorker<PoolCreatedJobData>(QUEUE_NAMES.POOL_CREATED, (job) =>
        this.handlePoolCreated(job),
      ),
      this.makeWorker<SwapProcessedJobData>(QUEUE_NAMES.SWAP_PROCESSED, (job) =>
        this.handleSwapProcessed(job),
      ),
      this.makeWorker<PositionMintedJobData>(QUEUE_NAMES.POSITION_MINTED, (job) =>
        this.handlePositionMinted(job),
      ),
      this.makeWorker<PositionBurnedJobData>(QUEUE_NAMES.POSITION_BURNED, (job) =>
        this.handlePositionBurned(job),
      ),
      this.makeWorker<FeesCollectedJobData>(QUEUE_NAMES.FEES_COLLECTED, (job) =>
        this.handleFeesCollected(job),
      ),
    );

    for (const name of Object.values(QUEUE_NAMES)) {
      const qe = new QueueEvents(name, { connection });
      qe.on('failed', ({ jobId, failedReason }) => {
        this.logger.error(`[DLQ] queue=${name} jobId=${jobId} reason=${failedReason}`);
      });
      this.queueEvents.push(qe);
    }

    this.logger.log('Indexer workers started');
    void this.logQueueDepths();
    setInterval(() => void this.logQueueDepths(), 60_000);
  }

  async onModuleDestroy() {
    await Promise.all([
      ...this.workers.map((w) => w.close()),
      ...this.queueEvents.map((qe) => qe.close()),
    ]);
    await this.prisma.$disconnect();
    this.logger.log('Indexer workers shut down gracefully');
  }

  private makeWorker<T>(
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
  ): Worker<T> {
    const { connection } = makeQueueOptions();
    const worker = new Worker<T>(queueName, handler, { connection });

    worker.on('completed', (job) => {
      this.logger.log(`completed queue=${queueName} jobId=${job.id}`);
    });
    worker.on('failed', (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      this.logger.warn(
        `failed queue=${queueName} jobId=${job?.id} attempt=${attempts} err=${err.message}`,
      );
    });

    return worker;
  }

  private async logQueueDepths() {
    for (const worker of this.workers) {
      const counts = await worker.client.then(async (client) => {
        const waiting = await client.llen(`bull:${worker.name}:wait`);
        const active = await client.llen(`bull:${worker.name}:active`);
        return { waiting, active };
      }).catch(() => null);

      if (counts) {
        this.logger.log(
          `queue=${worker.name} waiting=${counts.waiting} active=${counts.active}`,
        );
      }
    }
  }

  private async handlePoolCreated(job: Job<PoolCreatedJobData>) {
    const d = job.data;
    await this.prisma.poolCreated.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        tokenA: d.tokenA,
        tokenB: d.tokenB,
        fee: d.fee,
        sqrtPriceX96: d.sqrtPriceX96,
      },
    });
  }

  private async handleSwapProcessed(job: Job<SwapProcessedJobData>) {
    const d = job.data;
    await this.prisma.swapProcessed.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        sender: d.sender,
        recipient: d.recipient,
        amount0: d.amount0,
        amount1: d.amount1,
        sqrtPriceX96: d.sqrtPriceX96,
        liquidity: d.liquidity,
        tick: d.tick,
      },
    });
  }

  private async handlePositionMinted(job: Job<PositionMintedJobData>) {
    const d = job.data;
    await this.prisma.positionMinted.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        owner: d.owner,
        tickLower: d.tickLower,
        tickUpper: d.tickUpper,
        liquidity: d.liquidity,
        amount0: d.amount0,
        amount1: d.amount1,
      },
    });
  }

  private async handlePositionBurned(job: Job<PositionBurnedJobData>) {
    const d = job.data;
    await this.prisma.positionBurned.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        owner: d.owner,
        tickLower: d.tickLower,
        tickUpper: d.tickUpper,
        liquidity: d.liquidity,
        amount0: d.amount0,
        amount1: d.amount1,
      },
    });
  }

  private async handleFeesCollected(job: Job<FeesCollectedJobData>) {
    const d = job.data;
    await this.prisma.feesCollected.upsert({
      where: { eventId: d.eventId },
      update: {},
      create: {
        eventId: d.eventId,
        poolId: d.poolId,
        recipient: d.recipient,
        amount0: d.amount0,
        amount1: d.amount1,
      },
    });
  }
}
