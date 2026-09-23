import { assertPublicWebhookUrl, isBlockedIp } from './webhook-url-guard';

describe('isBlockedIp', () => {
  it('blocks loopback, private, and link-local ranges', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.0.0.5')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
  });

  it('allows public IPs', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('93.184.216.34')).toBe(false);
  });
});

describe('assertPublicWebhookUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(
      assertPublicWebhookUrl('file:///etc/passwd'),
    ).rejects.toThrow();
  });

  it('rejects literal private IP targets', async () => {
    await expect(
      assertPublicWebhookUrl('http://169.254.169.254/latest'),
    ).rejects.toThrow();
    await expect(
      assertPublicWebhookUrl('http://127.0.0.1:8080'),
    ).rejects.toThrow();
  });

  it('allows a literal public IP target', async () => {
    await expect(
      assertPublicWebhookUrl('http://8.8.8.8'),
    ).resolves.toBeUndefined();
  });
});
