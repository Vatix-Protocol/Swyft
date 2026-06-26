import { Test, TestingModule } from '@nestjs/testing';
import { SearchModule } from './search.module';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = { $queryRawUnsafe: jest.fn() };

describe('SearchModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [SearchModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('compiles without errors', () => {
    expect(module).toBeDefined();
  });
});
