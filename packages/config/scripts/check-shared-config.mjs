#!/usr/bin/env node
/**
 * Enforces the shared TypeScript + ESLint config from @swyft/config (issue #1036).
 *
 * Usage:
 *   node packages/config/scripts/check-shared-config.mjs            # static + effective checks
 *   node packages/config/scripts/check-shared-config.mjs --static   # skip loading ESLint
 *
 * Invariants (see packages/config/README.md):
 *   - Every non-exempt workspace (apps/*, packages/* with a package.json) has a
 *     tsconfig.json whose `extends` chain reaches packages/config/tsconfig.base.json.
 *   - No tsconfig in a workspace downgrades a protected strictness flag.
 *   - Every workspace with a `lint` script has an eslint.config.* that spreads
 *     `swyftEslintConfig()` from packages/config/eslint.js.
 *   - The *effective* ESLint config of each lint workspace keeps every shared
 *     security rule at `error` (so an app cannot silently weaken it).
 *   - Every path @swyft/config advertises in `files`/`exports` exists.
 *
 * Deny-by-default: a new workspace is checked unless it is added to
 * EXEMPT_WORKSPACES with a reason. Exit codes: 0 ok, 1 violations, 2 usage error.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = path.resolve(CONFIG_DIR, '..', '..');
const BASE_TSCONFIG = 'packages/config/tsconfig.base.json';
const SHARED_ESLINT = 'packages/config/eslint.js';

/** Stable error codes. Never rename — CI logs and runbooks key off these. */
export const ERROR_CODES = Object.freeze({
  TSCONFIG_MISSING: 'SHARED_CONFIG_TSCONFIG_MISSING',
  TSCONFIG_INVALID: 'SHARED_CONFIG_TSCONFIG_INVALID',
  TSCONFIG_NOT_EXTENDED: 'SHARED_CONFIG_TSCONFIG_NOT_EXTENDED',
  TS_STRICTNESS_DOWNGRADED: 'SHARED_CONFIG_TS_STRICTNESS_DOWNGRADED',
  ESLINT_MISSING: 'SHARED_CONFIG_ESLINT_MISSING',
  ESLINT_NOT_SHARED: 'SHARED_CONFIG_ESLINT_NOT_SHARED',
  ESLINT_UNRESOLVED: 'SHARED_CONFIG_ESLINT_UNRESOLVED',
  ESLINT_RULE_WEAKENED: 'SHARED_CONFIG_ESLINT_RULE_WEAKENED',
  PACKAGE_FILE_MISSING: 'SHARED_CONFIG_PACKAGE_FILE_MISSING',
});

/**
 * Workspaces allowed to skip the shared tsconfig/eslint, with the reason.
 * Keep this list short; every entry is a reviewed exception.
 */
export const EXEMPT_WORKSPACES = Object.freeze({
  'packages/contract':
    'Soroban/Rust contracts; its TS is deploy tooling run via tsx/ts-jest without a tsconfig',
});

/**
 * Compiler options that no workspace tsconfig may set to `false`. The base sets
 * `strict: true`; these are the flags `strict` implies plus casing safety.
 * `strictPropertyInitialization` is intentionally absent (NestJS DI in apps/api).
 */
export const PROTECTED_COMPILER_OPTIONS = Object.freeze([
  'strict',
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'noImplicitThis',
  'alwaysStrict',
  'useUnknownInCatchVariables',
  'forceConsistentCasingInFileNames',
]);

const ESLINT_CONFIG_FILES = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs'];

function violation(code, file, message) {
  return { code, file, message };
}

function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** Restrict correlation ids to a log-safe charset so they cannot inject log lines. */
export function sanitizeCorrelationId(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 64);
  return cleaned || null;
}

export function resolveCorrelationId(env) {
  const explicit = sanitizeCorrelationId(env.SHARED_CONFIG_CORRELATION_ID);
  if (explicit) return explicit;
  if (env.GITHUB_RUN_ID) {
    return sanitizeCorrelationId(`${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}-config`);
  }
  return `local-${process.pid}`;
}

// ── Workspaces ────────────────────────────────────────────────────────────────

/** apps/* and packages/* directories that contain a package.json. */
export function listWorkspaces(root) {
  const out = [];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const pkgFile = path.join(dir, name, 'package.json');
      if (!fs.existsSync(pkgFile)) continue;
      out.push({
        id: `${group}/${name}`,
        dir: path.join(dir, name),
        pkg: JSON.parse(fs.readFileSync(pkgFile, 'utf8')),
      });
    }
  }
  return out;
}

// ── TypeScript ────────────────────────────────────────────────────────────────

let tsModule;
function ts() {
  tsModule ??= require('typescript');
  return tsModule;
}

function readTsconfig(file) {
  const text = fs.readFileSync(file, 'utf8');
  const { config, error } = ts().parseConfigFileTextToJson(file, text);
  if (error) {
    throw new Error(ts().flattenDiagnosticMessageText(error.messageText, '\n'));
  }
  return config ?? {};
}

function resolveExtends(root, fromFile, specifier) {
  const fromDir = path.dirname(fromFile);
  const withJson = (p) => (fs.existsSync(p) || p.endsWith('.json') ? p : `${p}.json`);
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    return withJson(path.resolve(fromDir, specifier));
  }
  if (specifier === '@swyft/config/tsconfig.base.json') {
    // Always the workspace source of truth, never a stale installed copy.
    return path.join(root, BASE_TSCONFIG);
  }
  return require.resolve(specifier, { paths: [fromDir] });
}

/**
 * Walks the `extends` chain of a tsconfig.
 * @returns {{ chain: string[], configs: Map<string, object> }}
 */
export function resolveTsconfigChain(root, file, depth = 0, seen = new Set()) {
  if (depth > 16 || seen.has(file))
    throw new Error(`extends cycle or depth > 16 at ${rel(root, file)}`);
  seen.add(file);
  if (!fs.existsSync(file)) throw new Error(`${rel(root, file)} does not exist`);
  const config = readTsconfig(file);
  const chain = [file];
  const configs = new Map([[file, config]]);
  const parents = config.extends == null ? [] : [].concat(config.extends);
  for (const parent of parents) {
    if (typeof parent !== 'string') throw new Error(`invalid extends in ${rel(root, file)}`);
    const sub = resolveTsconfigChain(root, resolveExtends(root, file, parent), depth + 1, seen);
    chain.push(...sub.chain);
    for (const [k, v] of sub.configs) configs.set(k, v);
  }
  return { chain, configs };
}

export function checkTsconfigs(root, workspaces) {
  const errors = [];
  const base = path.join(root, BASE_TSCONFIG);
  for (const ws of workspaces) {
    if (EXEMPT_WORKSPACES[ws.id]) continue;
    const primary = path.join(ws.dir, 'tsconfig.json');
    if (!fs.existsSync(primary)) {
      errors.push(
        violation(
          ERROR_CODES.TSCONFIG_MISSING,
          `${ws.id}/tsconfig.json`,
          `must exist and extend ${BASE_TSCONFIG}`
        )
      );
      continue;
    }
    const files = fs
      .readdirSync(ws.dir)
      .filter((n) => /^tsconfig(\..+)?\.json$/.test(n) && n !== 'tsconfig.base.json')
      .sort()
      .map((n) => path.join(ws.dir, n));
    for (const file of files) {
      const fileRel = rel(root, file);
      let resolved;
      try {
        resolved = resolveTsconfigChain(root, file);
      } catch (err) {
        errors.push(violation(ERROR_CODES.TSCONFIG_INVALID, fileRel, err.message));
        continue;
      }
      if (!resolved.chain.includes(base)) {
        errors.push(
          violation(
            ERROR_CODES.TSCONFIG_NOT_EXTENDED,
            fileRel,
            `extends chain does not reach ${BASE_TSCONFIG}`
          )
        );
      }
      for (const [configFile, config] of resolved.configs) {
        if (configFile === base) continue;
        for (const option of PROTECTED_COMPILER_OPTIONS) {
          if (config.compilerOptions?.[option] === false) {
            errors.push(
              violation(
                ERROR_CODES.TS_STRICTNESS_DOWNGRADED,
                rel(root, configFile),
                `compilerOptions.${option} must not be false (shared base requires it)`
              )
            );
          }
        }
      }
    }
  }
  return dedupe(errors);
}

// ── ESLint ────────────────────────────────────────────────────────────────────

function findEslintConfig(dir) {
  for (const name of ESLINT_CONFIG_FILES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function lintWorkspaces(workspaces) {
  return workspaces.filter(
    (ws) => !EXEMPT_WORKSPACES[ws.id] && typeof ws.pkg.scripts?.lint === 'string'
  );
}

/** Static check: each lint workspace's config imports and spreads the shared layer. */
export function checkEslintStatic(root, workspaces) {
  const errors = [];
  for (const ws of lintWorkspaces(workspaces)) {
    const file = findEslintConfig(ws.dir);
    if (!file) {
      errors.push(
        violation(
          ERROR_CODES.ESLINT_MISSING,
          ws.id,
          `has a lint script but no ${ESLINT_CONFIG_FILES.join(' / ')}`
        )
      );
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    const sharedPath = rel(path.dirname(file), path.join(root, SHARED_ESLINT));
    const imports = [
      '@swyft/config/eslint',
      sharedPath,
      sharedPath.startsWith('.') ? null : `./${sharedPath}`,
    ].filter(Boolean);
    const importsShared = imports.some(
      (spec) => source.includes(`'${spec}'`) || source.includes(`"${spec}"`)
    );
    if (
      !importsShared ||
      !/\.\.\.\s*\w+\.swyftEslintConfig\(\)|\.\.\.\s*swyftEslintConfig\(\)/.test(source)
    ) {
      errors.push(
        violation(
          ERROR_CODES.ESLINT_NOT_SHARED,
          rel(root, file),
          `must import ${SHARED_ESLINT} (or @swyft/config/eslint) and spread swyftEslintConfig()`
        )
      );
    }
  }
  return errors;
}

function severity(entry) {
  const level = Array.isArray(entry) ? entry[0] : entry;
  if (level === 'error' || level === 2) return 2;
  if (level === 'warn' || level === 1) return 1;
  return 0;
}

/**
 * Effective check: loads each workspace's own ESLint and asks it for the
 * computed config of a probe file, then asserts every shared security rule is
 * still `error`. Fails closed if ESLint cannot be loaded.
 */
export async function checkEslintEffective(root, workspaces) {
  const { securityRules } = require(path.join(root, SHARED_ESLINT));
  const errors = [];
  for (const ws of lintWorkspaces(workspaces)) {
    const file = findEslintConfig(ws.dir);
    if (!file) continue; // reported by the static check
    let computed;
    try {
      const eslintEntry = createRequire(path.join(ws.dir, 'package.json')).resolve('eslint');
      const { ESLint } = await import(pathToFileURL(eslintEntry).href);
      const eslint = new ESLint({ cwd: ws.dir, overrideConfigFile: file });
      computed = await eslint.calculateConfigForFile(
        path.join(ws.dir, 'src', '__swyft_probe__.ts')
      );
    } catch (err) {
      errors.push(
        violation(
          ERROR_CODES.ESLINT_UNRESOLVED,
          ws.id,
          `could not load effective ESLint config: ${err.message}`
        )
      );
      continue;
    }
    if (!computed) {
      errors.push(
        violation(
          ERROR_CODES.ESLINT_RULE_WEAKENED,
          rel(root, file),
          'effective config does not apply to src/**/*.ts, so shared security rules are not enforced'
        )
      );
      continue;
    }
    for (const rule of Object.keys(securityRules)) {
      if (severity(computed?.rules?.[rule]) !== 2) {
        errors.push(
          violation(
            ERROR_CODES.ESLINT_RULE_WEAKENED,
            rel(root, file),
            `effective severity of ${rule} must be "error" (shared security rule)`
          )
        );
      }
    }
  }
  return errors;
}

// ── @swyft/config package integrity ───────────────────────────────────────────

export function checkPackageFiles(root) {
  const pkgDir = path.join(root, 'packages', 'config');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const targets = new Set([...(pkg.files ?? []), ...Object.values(pkg.exports ?? {})]);
  const errors = [];
  for (const target of targets) {
    if (typeof target !== 'string') continue;
    if (!fs.existsSync(path.join(pkgDir, target))) {
      errors.push(
        violation(
          ERROR_CODES.PACKAGE_FILE_MISSING,
          'packages/config/package.json',
          `advertises ${target} in files/exports but it does not exist`
        )
      );
    }
  }
  return errors;
}

function dedupe(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const key = `${e.code}|${e.file}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Runs every shared-config invariant. Read-only.
 * @returns {Promise<{ errors: Array<{code: string, file: string, message: string}>, workspaces: number }>}
 */
export async function checkSharedConfig({ root = DEFAULT_ROOT, effective = true } = {}) {
  const workspaces = listWorkspaces(root);
  const errors = [
    ...checkPackageFiles(root),
    ...checkTsconfigs(root, workspaces),
    ...checkEslintStatic(root, workspaces),
  ];
  if (effective) errors.push(...(await checkEslintEffective(root, workspaces)));
  return { errors, workspaces: workspaces.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), env = process.env) {
  const unknown = argv.filter((a) => a !== '--static');
  if (unknown.length > 0) {
    console.error(`Usage: check-shared-config.mjs [--static] (unknown: ${unknown.join(' ')})`);
    return 2;
  }
  const correlationId = resolveCorrelationId(env);
  const result = await checkSharedConfig({ effective: !argv.includes('--static') });
  for (const e of result.errors) console.error(`✖ [${e.code}] ${e.file}: ${e.message}`);
  if (result.errors.length === 0) {
    console.log(
      `✔ ${result.workspaces} workspace(s) use the shared @swyft/config TS/ESLint config`
    );
  } else {
    console.error('\nSee packages/config/README.md for how to adopt the shared config.');
  }
  const errorsByCode = {};
  for (const e of result.errors) errorsByCode[e.code] = (errorsByCode[e.code] || 0) + 1;
  console.log(
    JSON.stringify({
      event: 'shared_config.check',
      correlationId,
      status: result.errors.length === 0 ? 'ok' : 'fail',
      errorCount: result.errors.length,
      errorsByCode,
    })
  );
  return result.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
