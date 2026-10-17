import { createHmac } from 'crypto';
import { verifyWebhookSignature } from './webhook.types';

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'swap' });
  const valid = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a correct HMAC-SHA256 hex digest', () => {
    expect(verifyWebhookSignature(body, valid, secret)).toBe(true);
  });

  it('rejects a well-formed but wrong 64-character signature', () => {
    expect(verifyWebhookSignature(body, 'a'.repeat(64), secret)).toBe(false);
  });

  it('rejects a valid digest followed by extra characters', () => {
    expect(verifyWebhookSignature(body, `${valid}zz`, secret)).toBe(false);
    expect(verifyWebhookSignature(body, `${valid}ab`, secret)).toBe(false);
  });

  it('rejects a valid prefix padded with non-hex characters to 64 characters', () => {
    const padded = `${valid.slice(0, 62)}zz`;
    expect(padded).toHaveLength(64);
    expect(verifyWebhookSignature(body, padded, secret)).toBe(false);
  });

  it('rejects odd-length and non-hex signatures', () => {
    expect(verifyWebhookSignature(body, valid.slice(0, 63), secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'not-a-signature', secret)).toBe(false);
  });

  it('rejects an empty signature or secret', () => {
    expect(verifyWebhookSignature(body, '', secret)).toBe(false);
    expect(verifyWebhookSignature(body, valid, '')).toBe(false);
  });
});
