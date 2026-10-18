import { classifyQueryDuration, parseThresholdMs, PrismaService } from './prisma.service';
import { DbMetricsService } from '../metrics/db-metrics.service';

const mockDbMetrics = {
  record: jest.fn(),
  snapshot: jest.fn(),
  setPoolCount: jest.fn(),
  recordSwap: jest.fn(),
} as unknown as DbMetricsService;

describe('classifyQueryDuration', () => {
  it('returns debug when duration is below the warn threshold', () => {
    expect(classifyQueryDuration(50, 100, 500)).toBe('debug');
    expect(classifyQueryDuration(99, 100, 500)).toBe('debug');
  });

  it('returns warn when duration is between the thresholds', () => {
    expect(classifyQueryDuration(100, 100, 500)).toBe('warn');
    expect(classifyQueryDuration(300, 100, 500)).toBe('warn');
    expect(classifyQueryDuration(499, 100, 500)).toBe('warn');
  });

  it('returns error when duration is at or above the error threshold', () => {
    expect(classifyQueryDuration(500, 100, 500)).toBe('error');
    expect(classifyQueryDuration(800, 100, 500)).toBe('error');
  });

  it('uses custom thresholds', () => {
    expect(classifyQueryDuration(200, 100, 200)).toBe('error');
    expect(classifyQueryDuration(150, 100, 200)).toBe('warn');
    expect(classifyQueryDuration(50, 100, 200)).toBe('debug');
  });
});

describe('parseThresholdMs', () => {
  it('returns the parsed value when it is a positive finite number', () => {
    expect(parseThresholdMs('250', 100)).toBe(250);
    expect(parseThresholdMs('100', 100)).toBe(100);
  });

  it('falls back to the default when the env value is undefined', () => {
    expect(parseThresholdMs(undefined, 100)).toBe(100);
  });

  it('falls back to the default when the env value is non-numeric', () => {
    expect(parseThresholdMs('not-a-number', 100)).toBe(100);
    expect(parseThresholdMs('abc', 500)).toBe(500);
  });

  it('falls back to the default when the env value is zero', () => {
    expect(parseThresholdMs('0', 100)).toBe(100);
    expect(parseThresholdMs('0', 500)).toBe(500);
  });

  it('falls back to the default when the env value is negative', () => {
    expect(parseThresholdMs('-50', 100)).toBe(100);
  });

  it('falls back to the default when the env value is NaN-producing', () => {
    expect(parseThresholdMs('', 100)).toBe(100);
    expect(parseThresholdMs('  ', 100)).toBe(100);
  });
});

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService(mockDbMetrics);
  });

  it('defaults the slow threshold to 100', () => {
    // Access via the protected-ish field through the class instance.
    // @ts-ignore — accessing private field for test assertion.
    expect((service as unknown as { slowThreshold: number }).slowThreshold).toBe(100);
  });

  it('defaults the error threshold to 500', () => {
    // @ts-ignore — accessing private field for test assertion.
    expect((service as unknown as { errorThreshold: number }).errorThreshold).toBe(500);
  });
});