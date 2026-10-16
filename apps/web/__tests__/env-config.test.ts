import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Production-readiness checks for the web deployment surface.
 *
 * A containerized production build that fails to bake NEXT_PUBLIC_* values
 * into the image silently falls back to NEXT_PUBLIC_API_URL or localhost,
 * so we assert both the documented env surface (.env.example) and the
 * Docker build args that propagate it into the image.
 */

const webRoot = join(__dirname, '..');

function readWebFile(relativePath: string): string {
  return readFileSync(join(webRoot, relativePath), 'utf8');
}

describe('apps/web/.env.example', () => {
  const envExample = readWebFile('.env.example');

  it('documents the shared NEXT_PUBLIC_API_URL fallback', () => {
    expect(envExample).toContain('NEXT_PUBLIC_API_URL');
  });

  it('documents the per-network API URL overrides', () => {
    expect(envExample).toContain('NEXT_PUBLIC_API_URL_TESTNET');
    expect(envExample).toContain('NEXT_PUBLIC_API_URL_PUBLIC');
  });

  it('documents the browser API key', () => {
    expect(envExample).toContain('NEXT_PUBLIC_SWYFT_API_KEY');
  });

  it('does not assign a value to any credential-like variable', () => {
    const credentialAssignment = /^\s*(?:NEXT_PUBLIC_)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/m;
    expect(envExample).not.toMatch(credentialAssignment);
  });
});

describe('apps/web/Dockerfile', () => {
  const dockerfile = readWebFile('Dockerfile');

  it('declares the shared NEXT_PUBLIC_API_URL as a build arg and env', () => {
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_URL/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_API_URL=/);
  });

  it('declares the per-network API URL overrides as build args and envs', () => {
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_URL_TESTNET/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_API_URL_TESTNET=/);
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_URL_PUBLIC/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_API_URL_PUBLIC=/);
  });

  it('declares the browser API key as a build arg and env', () => {
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_SWYFT_API_KEY/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_SWYFT_API_KEY=/);
  });
});
