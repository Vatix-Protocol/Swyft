/**
 * Tests for scripts/check-shared-config.mjs and eslint.js (issue #1036).
 * Run: cd packages/config && pnpm test
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ERROR_CODES,
  EXEMPT_WORKSPACES,
  PROTECTED_COMPILER_OPTIONS,
  checkSharedConfig,
  main,
  resolveCorrelationId,
  sanitizeCorrelationId,
} from '../check-shared-config.mjs';

const require = createRequire(import.meta.url);
const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(CONFIG_DIR, '..', '..');
const shared = require('../../eslint.js');

const codes = (result) => result.errors.map((e) => e.code);

// ── Sandbox repo ──────────────────────────────────────────────────────────────

const GOOD_ESLINT = `import swyftConfig from '../../packages/config/eslint.js';
export default [{ files: ['**/*.ts'] }, ...swyftConfig.swyftEslintConfig()];
`;

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`
  );
}

/** Minimal monorepo: the real packages/config plus one app and one package. */
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-config-'));
  for (const file of ['package.json', 'tsconfig.base.json', 'tsconfig.json', 'eslint.js']) {
    fs.cpSync(path.join(CONFIG_DIR, file), path.join(root, 'packages/config', file));
  }
  fs.cpSync(path.join(CONFIG_DIR, 'src'), path.join(root, 'packages/config/src'), {
    recursive: true,
  });
  fs.cpSync(path.join(CONFIG_DIR, 'scripts'), path.join(root, 'packages/config/scripts'), {
    recursive: true,
  });
  // `typescript` for tsconfig parsing resolves relative to the script location.
  fs.symlinkSync(
    path.join(CONFIG_DIR, 'node_modules'),
    path.join(root, 'packages/config/node_modules')
  );

  write(root, 'apps/app/package.json', { name: 'app', scripts: { lint: 'eslint' } });
  write(root, 'apps/app/tsconfig.json', { extends: '../../packages/config/tsconfig.base.json' });
  write(root, 'apps/app/eslint.config.mjs', GOOD_ESLINT);
  write(root, 'packages/lib/package.json', { name: 'lib' });
  write(root, 'packages/lib/tsconfig.json', {
    extends: '@swyft/config/tsconfig.base.json',
    compilerOptions: { strictPropertyInitialization: false },
  });
  return root;
}

let root;
beforeEach(() => {
  root = makeSandbox();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const staticCheck = () => checkSharedConfig({ root, effective: false });

// ── Shared base invariants ────────────────────────────────────────────────────

describe('shared tsconfig.base.json', () => {
  it('keeps strict mode and casing safety on', () => {
    const base = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'tsconfig.base.json'), 'utf8'));
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.forceConsistentCasingInFileNames).toBe(true);
    expect(base.compilerOptions.isolatedModules).toBe(true);
  });

  it('protects every flag implied by strict', () => {
    expect(PROTECTED_COMPILER_OPTIONS).toEqual(
      expect.arrayContaining(['strict', 'noImplicitAny', 'strictNullChecks'])
    );
    expect(PROTECTED_COMPILER_OPTIONS).not.toContain('strictPropertyInitialization');
  });
});

describe('shared eslint layer', () => {
  it('pins every security rule to error and puts security last', () => {
    for (const level of Object.values(shared.securityRules)) expect(level).toBe('error');
    const layers = shared.swyftEslintConfig();
    expect(layers.at(-1).name).toBe('swyft/security');
    expect(layers.at(-1).rules).toEqual(shared.securityRules);
  });

  it('returns fresh objects so callers cannot mutate the shared rules', () => {
    const layers = shared.swyftEslintConfig();
    layers.at(-1).rules['no-eval'] = 'off';
    expect(shared.swyftEslintConfig().at(-1).rules['no-eval']).toBe('error');
    expect(Object.isFrozen(shared.securityRules)).toBe(true);
  });
});

// ── Static enforcement ────────────────────────────────────────────────────────

describe('checkSharedConfig (static)', () => {
  it('passes for a compliant sandbox', async () => {
    expect((await staticCheck()).errors).toEqual([]);
  });

  it('rejects a workspace without tsconfig (deny-by-default)', async () => {
    write(root, 'packages/newpkg/package.json', { name: 'newpkg' });
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.TSCONFIG_MISSING]);
  });

  it('rejects a tsconfig that does not reach the shared base', async () => {
    write(root, 'packages/lib/tsconfig.json', { compilerOptions: { strict: true } });
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.TSCONFIG_NOT_EXTENDED]);
  });

  it('follows extends chains through sibling tsconfigs', async () => {
    write(root, 'packages/lib/tsconfig.build.json', { extends: './tsconfig.json' });
    expect((await staticCheck()).errors).toEqual([]);
    write(root, 'packages/lib/tsconfig.build.json', { compilerOptions: {} });
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.TSCONFIG_NOT_EXTENDED]);
  });

  it.each(['strict', 'strictNullChecks', 'noImplicitAny'])('rejects %s: false', async (option) => {
    write(root, 'apps/app/tsconfig.json', {
      extends: '../../packages/config/tsconfig.base.json',
      compilerOptions: { [option]: false },
    });
    const result = await staticCheck();
    expect(codes(result)).toEqual([ERROR_CODES.TS_STRICTNESS_DOWNGRADED]);
    expect(result.errors[0].message).toContain(option);
  });

  it('rejects strictness downgrades hidden in an intermediate config', async () => {
    write(root, 'apps/app/tsconfig.loose.json', {
      extends: '../../packages/config/tsconfig.base.json',
      compilerOptions: { strict: false },
    });
    write(root, 'apps/app/tsconfig.json', { extends: './tsconfig.loose.json' });
    expect(codes(await staticCheck())).toContain(ERROR_CODES.TS_STRICTNESS_DOWNGRADED);
  });

  it('reports extends cycles and unparsable tsconfigs as invalid', async () => {
    write(root, 'apps/app/tsconfig.json', { extends: './tsconfig.json' });
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.TSCONFIG_INVALID]);
    write(root, 'apps/app/tsconfig.json', '{ "extends": ');
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.TSCONFIG_INVALID]);
  });

  it('accepts JSONC tsconfigs (comments, trailing commas)', async () => {
    write(
      root,
      'apps/app/tsconfig.json',
      '{\n  // shared base\n  "extends": "../../packages/config/tsconfig.base.json",\n}\n'
    );
    expect((await staticCheck()).errors).toEqual([]);
  });

  it('rejects a lint workspace without an eslint config', async () => {
    fs.rmSync(path.join(root, 'apps/app/eslint.config.mjs'));
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.ESLINT_MISSING]);
  });

  it('rejects an eslint config that does not spread the shared layer', async () => {
    write(root, 'apps/app/eslint.config.mjs', 'export default [{ rules: {} }];\n');
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.ESLINT_NOT_SHARED]);
    write(
      root,
      'apps/app/eslint.config.mjs',
      "import swyftConfig from '../../packages/config/eslint.js';\nexport default [];\n"
    );
    expect(codes(await staticCheck())).toEqual([ERROR_CODES.ESLINT_NOT_SHARED]);
  });

  it('accepts the @swyft/config/eslint package specifier', async () => {
    write(
      root,
      'apps/app/eslint.config.mjs',
      "import swyftConfig from '@swyft/config/eslint';\nexport default [...swyftConfig.swyftEslintConfig()];\n"
    );
    expect((await staticCheck()).errors).toEqual([]);
  });

  it('rejects files/exports entries of @swyft/config that do not exist', async () => {
    fs.rmSync(path.join(root, 'packages/config/eslint.js'));
    expect(codes(await staticCheck())).toContain(ERROR_CODES.PACKAGE_FILE_MISSING);
  });

  it('only exempts the documented workspaces', () => {
    expect(Object.keys(EXEMPT_WORKSPACES)).toEqual(['packages/contract']);
    for (const reason of Object.values(EXEMPT_WORKSPACES))
      expect(reason.length).toBeGreaterThan(20);
  });
});

// ── Effective (ESLint-computed) enforcement ───────────────────────────────────

describe('checkSharedConfig (effective)', () => {
  const apiEslint = path.join(REPO_ROOT, 'apps/api/node_modules/eslint');
  const haveEslint = fs.existsSync(apiEslint);

  it.skipIf(!haveEslint)('passes when the shared layer is last', async () => {
    fs.symlinkSync(
      path.join(REPO_ROOT, 'apps/api/node_modules'),
      path.join(root, 'apps/app/node_modules')
    );
    write(
      root,
      'apps/app/eslint.config.mjs',
      `import tseslint from 'typescript-eslint';
import swyftConfig from '../../packages/config/eslint.js';
export default [tseslint.configs.base, { files: ['**/*.ts'] }, ...swyftConfig.swyftEslintConfig()];
`
    );
    expect((await checkSharedConfig({ root })).errors).toEqual([]);
  });

  it.skipIf(!haveEslint)('flags an app override placed after the shared layer', async () => {
    fs.symlinkSync(
      path.join(REPO_ROOT, 'apps/api/node_modules'),
      path.join(root, 'apps/app/node_modules')
    );
    write(
      root,
      'apps/app/eslint.config.mjs',
      `import tseslint from 'typescript-eslint';
import swyftConfig from '../../packages/config/eslint.js';
export default [
  tseslint.configs.base,
  { files: ['**/*.ts'] },
  ...swyftConfig.swyftEslintConfig(),
  { rules: { 'no-eval': 'warn' } },
];
`
    );
    const result = await checkSharedConfig({ root });
    expect(codes(result)).toEqual([ERROR_CODES.ESLINT_RULE_WEAKENED]);
    expect(result.errors[0].message).toContain('no-eval');
  });

  it.skipIf(!haveEslint)('flags a config that never applies to TypeScript files', async () => {
    fs.symlinkSync(
      path.join(REPO_ROOT, 'apps/api/node_modules'),
      path.join(root, 'apps/app/node_modules')
    );
    write(
      root,
      'apps/app/eslint.config.mjs',
      `import tseslint from 'typescript-eslint';
import swyftConfig from '../../packages/config/eslint.js';
export default [tseslint.configs.base, ...swyftConfig.swyftEslintConfig()];
`
    );
    const result = await checkSharedConfig({ root });
    expect(codes(result)).toEqual([ERROR_CODES.ESLINT_RULE_WEAKENED]);
    expect(result.errors[0].message).toContain('does not apply');
  });

  it('fails closed when ESLint cannot be loaded for a lint workspace', async () => {
    // Sandbox app has no node_modules, so eslint is unresolvable.
    expect(codes(await checkSharedConfig({ root }))).toEqual([ERROR_CODES.ESLINT_UNRESOLVED]);
  });

  it.skipIf(!haveEslint)(
    'passes on the real monorepo',
    async () => {
      expect((await checkSharedConfig({ root: REPO_ROOT })).errors).toEqual([]);
    },
    60_000
  );
});

// ── Observability / CLI ───────────────────────────────────────────────────────

describe('correlation ids and CLI', () => {
  it('sanitizes correlation ids against log injection', () => {
    expect(sanitizeCorrelationId('run\n{"status":"ok"}')).toBe('runstatusok');
    expect(sanitizeCorrelationId('')).toBeNull();
    expect(resolveCorrelationId({ GITHUB_RUN_ID: '7', GITHUB_RUN_ATTEMPT: '3' })).toBe(
      '7-3-config'
    );
  });

  it('returns exit code 2 for unknown flags', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--skip-everything'], {})).toBe(2);
    spy.mockRestore();
  });
});
