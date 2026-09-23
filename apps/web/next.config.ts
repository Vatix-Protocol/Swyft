import type { NextConfig } from 'next';
import path from 'path';

/**
 * Content-Security-Policy for the Swyft web app.
 *
 * Policy rationale:
 *  - default-src 'self'        — deny everything not explicitly permitted
 *  - script-src  'self' 'unsafe-inline'
 *                              — Next.js inline scripts (hydration, font loader)
 *                                require 'unsafe-inline'; nonce-based CSP is not
 *                                yet wired to the Next.js runtime here.
 *  - style-src   'self' 'unsafe-inline'
 *                              — Tailwind CSS and Radix UI inject inline styles.
 *  - img-src     'self' data: blob: https:
 *                              — Token logos are fetched from third-party CDNs;
 *                                blob: is needed for canvas toDataURL exports.
 *  - font-src    'self' https://fonts.gstatic.com
 *                              — Geist font served via Google Fonts CDN.
 *  - connect-src 'self' https: wss:
 *                              — Soroban RPC, Horizon, and the Swyft WebSocket feed.
 *  - frame-ancestors 'none'   — Prevents the app from being iframed (clickjacking).
 *  - object-src  'none'       — Disallow Flash and similar plugins.
 *  - base-uri    'self'       — Prevent base-tag injection.
 */
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
]
  .join('; ')
  .trim();

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
