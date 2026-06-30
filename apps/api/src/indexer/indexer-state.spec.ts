const mockPrismaClient = {
  indexerCursor: {
    findUnique: jest.fn(),
    upsert: jest.fn().mockResolvedValue({}),
  },
  indexerDeadLetter: {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(0),
  },
  $disconnect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrismaClient),
}));

import { CacheService } from '../cache/cache.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';
import { IndexerCursorService } from './indexer-cursor.service';
import { IndexerDeadLetterService } from './indexer-dead-letter.service';

describe('IndexerCursorService', () => {
  const cache = {
    get: jest.fn(),
    setMaxNumber: jest.fn(),
  } as unknown as CacheService;

  beforeEach(() => jest.clearAllMocks());

  it('restores the last ledger from Postgres when Redis is cold', async () => {
    (cache.get as jest.Mock).mockResolvedValue(null);
    mockPrismaClient.indexerCursor.findUnique.mockResolvedValue({
      cursor: '42',
    });
    (cache.setMaxNumber as jest.Mock).mockResolvedValue(true);

    await expect(new IndexerCursorService(cache).getLastLedger()).resolves.toBe(
      42,
    );
    expect(cache.setMaxNumber).toHaveBeenCalledWith(LAST_INDEXED_LEDGER_KEY, 42);
  });

  it('rejects stale or invalid cursor writes', async () => {
    await expect(
      new IndexerCursorService(cache).advanceLedger(-1),
    ).resolves.toBe(false);
    expect(mockPrismaClient.indexerCursor.upsert).not.toHaveBeenCalled();
  });

  it('persists an advanced ledger when Redis accepts it', async () => {
    (cache.setMaxNumber as jest.Mock).mockResolvedValue(true);
    mockPrismaClient.indexerCursor.findUnique.mockResolvedValue({
      cursor: '42',
    });

    await expect(
      new IndexerCursorService(cache).advanceLedger(43),
    ).resolves.toBe(true);
    expect(mockPrismaClient.indexerCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ledger' },
        update: { cursor: '43' },
      }),
    );
  });

  it('still persists an advanced ledger when Redis is unavailable', async () => {
    (cache.setMaxNumber as jest.Mock).mockResolvedValue(false);
    mockPrismaClient.indexerCursor.findUnique.mockResolvedValue({
      cursor: '42',
    });

    await expect(
      new IndexerCursorService(cache).advanceLedger(43),
    ).resolves.toBe(true);
    expect(mockPrismaClient.indexerCursor.upsert).toHaveBeenCalled();
  });
});

describe('IndexerDeadLetterService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts poison events by job id', async () => {
    await new IndexerDeadLetterService().recordDeadLetter({
      jobId: 'job-1',
      queueName: 'swap.processed',
      eventId: 'evt-1',
      data: { eventId: 'evt-1' },
      error: 'boom',
      attemptsMade: 3,
    });

    expect(mockPrismaClient.indexerDeadLetter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-1' },
        create: expect.objectContaining({ eventId: 'evt-1' }),
      }),
    );
  });

  it('returns an empty payload for invalid stored JSON', async () => {
    mockPrismaClient.indexerDeadLetter.findMany.mockResolvedValue([
      {
        jobId: 'job-1',
        queueName: 'swap.processed',
        eventId: 'evt-1',
        data: '{',
        error: 'boom',
        attemptsMade: 3,
      },
    ]);

    await expect(
      new IndexerDeadLetterService().getDeadLetters(),
    ).resolves.toEqual([expect.objectContaining({ data: {} })]);
  });
});
