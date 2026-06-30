import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { InternalKeyGuard } from './internal-key.guard';

const mockService = {
  getOverview: jest.fn().mockResolvedValue({ totalTvl: 0, totalSwapCount: 0 }),
  getTvl: jest.fn().mockResolvedValue({ interval: '7d', series: [] }),
  getVolume: jest.fn().mockResolvedValue({ interval: '7d', series: [] }),
  getFees: jest.fn().mockResolvedValue({ byPool: [] }),
};

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: mockService },
        { provide: InternalKeyGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it('returns the analytics overview', async () => {
    mockService.getOverview.mockResolvedValue({ totalTvl: 1000 });

    const result = await controller.getOverview();

    expect(mockService.getOverview).toHaveBeenCalled();
    expect(result).toEqual({ totalTvl: 1000 });
  });

  it('returns TVL timeseries', async () => {
    mockService.getTvl.mockResolvedValue({ interval: '7d', series: [] });

    const result = await controller.getTvl({ interval: '7d' } as any);

    expect(mockService.getTvl).toHaveBeenCalledWith('7d');
    expect(result).toEqual({ interval: '7d', series: [] });
  });

  it('returns volume timeseries', async () => {
    mockService.getVolume.mockResolvedValue({ interval: '1d', series: [] });

    const result = await controller.getVolume({ interval: '1d' } as any);

    expect(mockService.getVolume).toHaveBeenCalledWith('1d');
    expect(result).toEqual({ interval: '1d', series: [] });
  });

  it('returns fee totals', async () => {
    mockService.getFees.mockResolvedValue({ byPool: [{ poolId: 'p1', feesAmount0: '10', feesAmount1: '20' }] });

    const result = await controller.getFees();

    expect(mockService.getFees).toHaveBeenCalled();
    expect(result).toEqual({ byPool: [{ poolId: 'p1', feesAmount0: '10', feesAmount1: '20' }] });
  });
});
