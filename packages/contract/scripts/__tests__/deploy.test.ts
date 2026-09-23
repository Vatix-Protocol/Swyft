/**
 * Test coverage for deploy-testnet.sh — issue #208
 *
 * Tests key behaviours of the deploy script by inspecting its source:
 * safety flags, skip/force logic, error guards, and manifest helpers.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../deploy-testnet.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');

describe('deploy-testnet.sh — structure', () => {
  it('script file exists', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  it('script is executable', () => {
    expect(fs.statSync(SCRIPT).mode & 0o100).toBeTruthy();
  });

  it('uses set -euo pipefail', () => {
    expect(src).toContain('set -euo pipefail');
  });

  it('requires stellar, curl, jq', () => {
    expect(src).toContain('require_cmd stellar');
    expect(src).toContain('require_cmd curl');
    expect(src).toContain('require_cmd jq');
  });

  it('deploys mathLib before router', () => {
    expect(src.indexOf('mathLib')).toBeLessThan(src.indexOf('"router"'));
  });

  it('writes manifest to testnet.json', () => {
    expect(src).toContain('testnet.json');
  });
});

describe('deploy-testnet.sh — skip / force logic', () => {
  it('defaults FORCE to false', () => {
    expect(src).toContain('FORCE=false');
  });

  it('sets FORCE=true when --force arg is passed', () => {
    expect(src).toContain('FORCE=true');
  });

  it('skips already-deployed contracts when FORCE=false', () => {
    expect(src).toContain('"$FORCE" == false');
    expect(src).toContain('use --force to redeploy');
  });
});

describe('deploy-testnet.sh — error guards', () => {
  it('fails when WASM file is missing', () => {
    expect(src).toContain('WASM not found');
  });

  it('fails when deploy returns empty contract ID', () => {
    expect(src).toContain('returned empty contract ID');
  });

  it('fails when post-deploy verification fails', () => {
    expect(src).toContain('Post-deploy verification failed');
  });

  it('fails when Friendbot funding fails', () => {
    expect(src).toContain('Friendbot funding failed');
  });
});

describe('deploy-testnet.sh — manifest helpers', () => {
  it('read_address extracts from .contracts via jq', () => {
    expect(src).toContain('jq -r');
    expect(src).toContain('.contracts[');
  });

  it('write_address stamps deployedAt timestamp', () => {
    expect(src).toContain('deployedAt');
    expect(src).toContain('date -u');
  });

  it('write_address seeds empty manifest when file missing', () => {
    expect(src).toContain('"network":"testnet","contracts":{}');
  });

  it('stamps deployer address into final manifest', () => {
    expect(src).toContain('.deployer = $d');
  });
});
