import { createHmac } from 'crypto';
import { verifyWebhookSignature } from './webhook.types';

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret';
  const body = '{"event":"swap"}';
  const valid = createHmac('sha256', secret).update(body).digest('hex');

  it('returns true for a correctly computed HMAC-SHA256 hex digest', () => {
    expect(verifyWebhookSignature(body, valid, secret)).toBe(true);
  });

  it('returns false for a well-formed but incorrect 64-char hex signature', () => {
    const wrong = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');
    expect(wrong).toMatch(/^[0-9a-fA-F]{64}$/);
    expect(verifyWebhookSignature(body, wrong, secret)).toBe(false);
  });

  it('returns false for an odd-length signature', () => {
    expect(verifyWebhookSignature(body, valid.slice(0, 63), secret)).toBe(false);
  });

  it('returns false for non-hex characters', () => {
    expect(verifyWebhookSignature(body, 'zz', secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'z'.repeat(64), secret)).toBe(false);
  });

  it('returns false for a valid hex prefix followed by junk', () => {
    expect(
      verifyWebhookSignature(body, `${valid.slice(0, 32)}!!!`, secret),
    ).toBe(false);
  });
});
