import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Production-readiness checks for the web app's deployment surface.
 *
 * The per-network API URL overrides (NEXT_PUBLIC_API_URL_TESTNET /
 * NEXT_PUBLIC_API_URL_PUBLIC) are read by apps/web/lib/constants.ts. If they
 * are undocumented in .env.example, operators cannot discover them; if the
 * Docker image does not propagate them as build args, a containerized
 * production build cannot bake them in at all. In both cases a PUBLIC/mainnet
 * deployment silently falls back to NEXT_PUBLIC_API_URL (or localhost), so
 * quotes, indexer data, LP positions, and wallet flows talk to the wrong API.
 */

const webDir = resolve(process.cwd());
const envExample = readFileSync(resolve(webDir, '.env.example'), 'utf8');
const dockerfile = readFileSync(resolve(webDir, 'Dockerfile'), 'utf8');

describe('apps/web/.env.example', () => {
  it('documents the per-network API URL overrides used by lib/constants.ts', () => {
    expect(envExample).toContain('NEXT_PUBLIC_API_URL_TESTNET');
    expect(envExample).toContain('NEXT_PUBLIC_API_URL_PUBLIC');
  });
});

describe('apps/web/Dockerfile', () => {
  it('declares NEXT_PUBLIC_API_URL_TESTNET as a build arg and bakes it in', () => {
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_URL_TESTNET/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_API_URL_TESTNET=/);
  });

  it('declares NEXT_PUBLIC_API_URL_PUBLIC as a build arg and bakes it in', () => {
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_URL_PUBLIC/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_API_URL_PUBLIC=/);
  });
});
