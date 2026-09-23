import { lookup } from 'dns/promises';
import { isIP } from 'net';

export const WEBHOOK_FETCH_TIMEOUT_MS = Number(
  process.env.WEBHOOK_FETCH_TIMEOUT_MS ?? '5000',
);
const DNS_LOOKUP_TIMEOUT_MS = Number(
  process.env.WEBHOOK_DNS_TIMEOUT_MS ?? '3000',
);

/**
 * Blocks SSRF via webhook URLs: rejects non-http(s) schemes and any
 * hostname/IP that resolves to a loopback, link-local (incl. cloud metadata
 * 169.254.169.254), private, or reserved address.
 */
export function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // private
      a === 0 || // "this" network
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) // private
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fe80:') || // link-local
      lower.startsWith('fc') ||
      lower.startsWith('fd') // unique local
    );
  }
  return false;
}

export async function assertPublicWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid webhook URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use http or https');
  }

  const hostname = parsed.hostname;
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error('Webhook URL resolves to a blocked address');
    }
    return;
  }

  const records = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Webhook URL DNS lookup timed out')),
        DNS_LOOKUP_TIMEOUT_MS,
      ),
    ),
  ]);
  for (const { address } of records) {
    if (isBlockedIp(address)) {
      throw new Error('Webhook URL resolves to a blocked address');
    }
  }
}
