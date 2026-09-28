import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as StellarSdk from '@stellar/stellar-sdk';

import { ApiKeyGuard } from '../src/auth/api-key.guard';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { NonceController } from '../src/auth/nonce.controller';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { BalancesController } from '../src/balances/balances.controller';
import { BalancesService } from '../src/balances/balances.service';

describe('wallet auth to balances (e2e)', () => {
  let app: INestApplication;
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(120),
    expire: jest.fn().mockResolvedValue(1),
  };
  const balances = {
    getBalances: jest.fn().mockResolvedValue({ TOKEN_CONTRACT: '12.5' }),
  };
  const jwt = { sign: jest.fn().mockReturnValue('e2e-access-token') };
  const wallet = StellarSdk.Keypair.random();

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await Test.createTestingModule({
      controllers: [NonceController, AuthController, BalancesController],
      providers: [
        AuthService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: BalancesService, useValue: balances },
        { provide: ApiKeyGuard, useValue: { canActivate: () => true } },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => '15m' } },
      ],
    }).compile();

    app = app.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('issues a nonce, verifies its signature, then reads balances', async () => {
    redis.set.mockResolvedValueOnce('OK');
    redis.get.mockImplementationOnce(() => redis.set.mock.calls[0][1]);
    redis.eval.mockResolvedValueOnce(1);

    const nonceResponse = await request(app.getHttpServer())
      .post('/auth/nonce')
      .send({ walletAddress: wallet.publicKey() })
      .expect(200);

    expect(nonceResponse.body.nonce).toBeDefined();
    const signature = wallet.sign(Buffer.from(nonceResponse.body.nonce));

    const verifyResponse = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({
        walletAddress: wallet.publicKey(),
        nonce: nonceResponse.body.nonce,
        signature: Buffer.from(signature).toString('base64'),
      })
      .expect(200);

    expect(verifyResponse.body).toEqual({ accessToken: 'e2e-access-token' });

    await request(app.getHttpServer())
      .get('/balances')
      .set('authorization', `Bearer ${verifyResponse.body.accessToken}`)
      .set('x-api-key', 'e2e-api-key')
      .query({ address: wallet.publicKey() })
      .expect(200)
      .expect({ TOKEN_CONTRACT: '12.5' });
  });
});
