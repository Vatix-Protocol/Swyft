/**
 * Test coverage for deploy-testnet.sh — issue #208
 *
 * Tests key behaviours of the deploy script by inspecting its source:
 * safety flags, skip/force logic, error guards, and manifest helpers.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
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

  it('stores a SHA-256 digest for each deployed contract key', () => {
    expect(src).toContain("'.contracts[$k] = $v | .deployedAt[$k] = $t | .wasmHashes[$k] = $h'");
    expect(src).toContain('hash=$(wasm_hash "$wasm")');
  });
});

describe('deploy-testnet.sh — deployment manifest integration', () => {
  it('records the deployed WASM hashes and passes clean contract IDs to oracle wiring', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-deploy-test-'));
    try {
      const contractsDir = path.join(tempRoot, 'packages', 'contract');
      const scriptsDir = path.join(contractsDir, 'scripts');
      const deploymentsDir = path.join(contractsDir, 'deployments');
      const wasmDir = path.join(contractsDir, 'target', 'wasm32-unknown-unknown', 'release');
      const binDir = path.join(tempRoot, 'bin');
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.mkdirSync(deploymentsDir, { recursive: true });
      fs.mkdirSync(wasmDir, { recursive: true });
      fs.mkdirSync(binDir);
      fs.copyFileSync(SCRIPT, path.join(scriptsDir, 'deploy-testnet.sh'));
      fs.writeFileSync(
        path.join(deploymentsDir, 'testnet.json'),
        JSON.stringify({ network: 'testnet', contracts: {}, deployedAt: {}, wasmHashes: {} })
      );

      const artifacts = [
        ['mathLib', 'math_lib'],
        ['poolFactory', 'pool_factory'],
        ['pool', 'pool'],
        ['clPool', 'cl_pool'],
        ['router', 'router'],
        ['positionNft', 'position_nft'],
        ['feeCollector', 'fee_collector'],
        ['oracleAdapter', 'oracle_adapter'],
        ['clPoolOracleAdapter', 'oracle_adapter'],
      ] as const;
      for (const [, wasmName] of artifacts) {
        const bytes = Buffer.from(`test artifact: ${wasmName}`);
        fs.writeFileSync(path.join(wasmDir, `${wasmName}.wasm`), bytes);
      }

      fs.writeFileSync(
        path.join(binDir, 'stellar'),
        `#!/usr/bin/env bash
set -euo pipefail
case "$1:$2" in
  "keys:show") exit 1 ;;
  "keys:generate") exit 0 ;;
  "keys:address") printf 'GTESTDEPLOYER\\n' ;;
  "account:balance") printf '100 XLM\\n' ;;
  "contract:build") exit 0 ;;
  "contract:deploy")
    count=$(cat "$TEST_DEPLOY_COUNT" 2>/dev/null || printf '0')
    count=$((count + 1))
    printf '%s' "$count" > "$TEST_DEPLOY_COUNT"
    printf 'CDEPLOYED%s\\n' "$count"
    ;;
  "contract:invoke")
    while (($#)); do
      if [[ "$1" == "--id" ]]; then
        shift
        printf '%s\\n' "$1" >> "$TEST_INVOKED_IDS"
      fi
      shift
    done
    ;;
  *) echo "Unexpected stellar command: $*" >&2; exit 1 ;;
esac
`
      );
      fs.writeFileSync(path.join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 0\n');
      fs.chmodSync(path.join(binDir, 'stellar'), 0o755);
      fs.chmodSync(path.join(binDir, 'curl'), 0o755);

      const invokedIdsPath = path.join(tempRoot, 'invoked-ids.txt');
      execFileSync('bash', [path.join(scriptsDir, 'deploy-testnet.sh')], {
        cwd: contractsDir,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          TEST_DEPLOY_COUNT: path.join(tempRoot, 'deploy-count'),
          TEST_INVOKED_IDS: invokedIdsPath,
        },
        timeout: 30_000,
      });

      const manifest = JSON.parse(
        fs.readFileSync(path.join(deploymentsDir, 'testnet.json'), 'utf8')
      );
      expect(manifest.deployer).toBe('GTESTDEPLOYER');
      for (const [index, [key, wasmName]] of artifacts.entries()) {
        expect(manifest.contracts[key]).toBe(`CDEPLOYED${index + 1}`);
        expect(manifest.wasmHashes[key]).toBe(
          crypto
            .createHash('sha256')
            .update(Buffer.from(`test artifact: ${wasmName}`))
            .digest('hex')
        );
      }

      const invokedIds = fs.readFileSync(invokedIdsPath, 'utf8').trim().split('\n');
      expect(invokedIds).toHaveLength(13);
      expect(invokedIds.every((id) => /^CDEPLOYED\d+$/.test(id))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
