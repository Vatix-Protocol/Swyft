import { CacheService } from './cache.service';

describe('CacheService.publish', () => {
  let service: CacheService;
  let publishMock: jest.Mock;

  beforeEach(() => {
    service = new CacheService();
    publishMock = jest.fn().mockResolvedValue(1);
    (service as any).available = true;
    (service as any).client = { publish: publishMock };
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      verbose: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true when the message is published', async () => {
    const result = await service.publish(
      'channel:1',
      '{"event":"pool.created"}',
    );

    expect(result).toBe(true);
    expect(publishMock).toHaveBeenCalledWith(
      'channel:1',
      '{"event":"pool.created"}',
    );
    expect((service as any).logger.warn).not.toHaveBeenCalled();
  });

  it('returns false and logs the channel when publish throws', async () => {
    publishMock.mockRejectedValue(new Error('Redis connection lost'));

    const result = await service.publish('channel:2', 'msg');

    expect(result).toBe(false);
    expect(publishMock).toHaveBeenCalledWith('channel:2', 'msg');
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('channel=channel:2'),
    );
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Redis connection lost'),
    );
  });

  it('returns false and logs at debug when Redis is unavailable', async () => {
    (service as any).available = false;

    const result = await service.publish('channel:3', 'msg');

    expect(result).toBe(false);
    expect(publishMock).not.toHaveBeenCalled();
    expect((service as any).logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('channel=channel:3'),
    );
    expect((service as any).logger.warn).not.toHaveBeenCalled();
  });
});
