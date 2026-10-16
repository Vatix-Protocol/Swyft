/**
 * Test coverage for deploy-testnet.sh — issue #208
 *
 * Behavioural tests run the deploy script against a temp tree with stub
 * `stellar`/`curl`/`jq` binaries. Only assertions that cannot be exercised
 * (e.g. the shebang) inspect the script source directly.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../deploy-testnet.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');

const ARTIFACTS = [
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

interface Harness {
  contractsDir: string;
  scriptsDir: string;
  deploymentsDir: string;
  wasmDir: string;
  invokedIdsPath: string;
  run: (args?: string[]) => { status: number; stdout: string; stderr: string };
  readManifest: () => any;
  cleanup: () => void;
}

/**
 * Builds a temp tree containing the deploy script, stub binaries, and WASM
 * artifacts so the script can be exercised end-to-end.
 */
function createHarness(options: { deployOutput?: string } = {}): Harness {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-deploy-test-'));
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

  for (const [, wasmName] of ARTIFACTS) {
    const bytes = Buffer.from(`test artifact: ${wasmName}`);
    fs.writeFileSync(path.join(wasmDir, `${wasmName}.wasm`), bytes);
  }

  const deployOutput = options.deployOutput ?? 'CDEPLOYED%s';
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
    printf '${deployOutput}\\n' "$count"
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
  const run = (args: string[] = []) => {
    try {
      const stdout = execFileSync('bash', [path.join(scriptsDir, 'deploy-testnet.sh'), ...args], {
        cwd: contractsDir,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          TEST_DEPLOY_COUNT: path.join(tempRoot, 'deploy-count'),
          TEST_INVOKED_IDS: invokedIdsPath,
        },
        timeout: 30_000,
        encoding: 'utf8',
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error: any) {
      return {
        status: typeof error.status === 'number' ? error.status : 1,
        stdout: error.stdout?.toString() ?? '',
        stderr: error.stderr?.toString() ?? '',
      };
    }
  };

  return {
    contractsDir,
    scriptsDir,
    deploymentsDir,
    wasmDir,
    invokedIdsPath,
    run,
    readManifest: () =>
      JSON.parse(fs.readFileSync(path.join(deploymentsDir, 'testnet.json'), 'utf8')),
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

describe('deploy-testnet.sh — structure', () => {
  it('script file exists', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  it('script is executable', () => {
    expect(fs.statSync(SCRIPT).mode & 0o100).toBeTruthy();
  });

  it('starts with a bash shebang', () => {
    expect(src.startsWith('#!/usr/bin/env bash')).toBe(true);
  });
});

describe('deploy-testnet.sh — skip / force logic', () => {
  it('skips already-deployed contracts when FORCE=false', () => {
    const harness = createHarness();
    try {
      const first = harness.run();
      expect(first.status).toBe(0);
      const afterFirst = harness.readManifest();
      expect(afterFirst.contracts.mathLib).toBe('CDEPLOYED1');

      const second = harness.run();
      expect(second.status).toBe(0);
      expect(second.stdout).toContain('use --force to redeploy');
      expect(harness.readManifest()).toEqual(afterFirst);
    } finally {
      harness.cleanup();
    }
  });

  it('redeploys already-deployed contracts when --force is passed', () => {
    const harness = createHarness();
    try {
      const first = harness.run();
      expect(first.status).toBe(0);
      const afterFirst = harness.readManifest();

      const forced = harness.run(['--force']);
      expect(forced.status).toBe(0);
      const afterForce = harness.readManifest();
      expect(afterForce.contracts.mathLib).not.toBe(afterFirst.contracts.mathLib);
      expect(afterForce.contracts.mathLib).toBe('CDEPLOYED10');
    } finally {
      harness.cleanup();
    }
  });
});

describe('deploy-testnet.sh — error guards', () => {
  it('fails when WASM file is missing', () => {
    const harness = createHarness();
    try {
      fs.rmSync(path.join(harness.wasmDir, 'math_lib.wasm'));
      const result = harness.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('WASM not found');
    } finally {
      harness.cleanup();
    }
  });

  it('fails when deploy returns empty contract ID', () => {
    const harness = createHarness({ deployOutput: '' });
    try {
      const result = harness.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('returned empty contract ID');
    } finally {
      harness.cleanup();
    }
  });
});

describe('deploy-testnet.sh — deployment manifest integration', () => {
  it('records the deployed WASM hashes and passes clean contract IDs to oracle wiring', () => {
    const harness = createHarness();
    try {
      const result = harness.run();
      expect(result.status).toBe(0);

      const manifest = harness.readManifest();
      expect(manifest.deployer).toBe('GTESTDEPLOYER');
      for (const [index, [key, wasmName]] of ARTIFACTS.entries()) {
        expect(manifest.contracts[key]).toBe(`CDEPLOYED${index + 1}`);
        expect(manifest.wasmHashes[key]).toBe(
          crypto
            .createHash('sha256')
            .update(Buffer.from(`test artifact: ${wasmName}`))
            .digest('hex')
        );
      }

      const invokedIds = fs.readFileSync(harness.invokedIdsPath, 'utf8').trim().split('\n');
      expect(invokedIds).toHaveLength(13);
      expect(invokedIds.every((id) => /^CDEPLOYED\d+$/.test(id))).toBe(true);
    } finally {
      harness.cleanup();
    }
  });
});
