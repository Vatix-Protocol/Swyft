import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SwapsController } from './swaps.controller';
import { SwapsService } from './swaps.service';

describe('Swagger: POST /swaps/quote', () => {
  it('includes a realistic request/response example in the generated OpenAPI JSON', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SwapsController],
      providers: [{ provide: SwapsService, useValue: {} }],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    const quoteOp = document.paths['/swaps/quote']?.post;
    expect(quoteOp).toBeDefined();

    // Request example, from the controller's @ApiBody({ examples }) block.
    const requestExample =
      quoteOp?.requestBody?.content?.['application/json']?.examples?.default
        ?.value;
    expect(requestExample).toEqual({
      poolId: 'cltest123456789012345678',
      tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      amountIn: '250.5',
      slippageBps: 50,
    });

    // Response example, derived from @ApiProperty({ example }) on the DTO.
    const responseSchema =
      document.components?.schemas?.['SwapQuoteResponseDto'];
    expect(responseSchema).toBeDefined();
    expect(
      (responseSchema as { properties: Record<string, { example: unknown }> })
        .properties,
    ).toMatchObject({
      amountOut: { example: '249.755925' },
      priceImpact: { example: 0 },
      lpFee: { example: '0.7515' },
      minimumReceived: { example: '248.507644' },
      executionPrice: { example: '0.996830' },
    });

    await app.close();
  });
});
