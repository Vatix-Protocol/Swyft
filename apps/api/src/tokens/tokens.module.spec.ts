import { Test, TestingModule } from '@nestjs/testing';
import { TokensModule } from './tokens.module';

describe('TokensModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [TokensModule],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('compiles without errors', () => {
    expect(module).toBeDefined();
  });
});
