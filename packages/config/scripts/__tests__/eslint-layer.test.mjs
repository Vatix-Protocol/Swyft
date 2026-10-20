/**
 * Asserts the shared ESLint layer is provably non-downgradable (issue #1225).
 *
 * The security block is emitted last by `swyftEslintConfig()` and carries no
 * `files` restriction, so its rules apply to every file — including test
 * files — and nothing earlier in the array can weaken them.
 *
 * Run: cd packages/config && pnpm test
 */
import { describe, expect, it } from 'vitest';

import { securityRules, swyftEslintConfig, testFileGlobs } from '../../eslint.js';

/** Convert a simple git-style glob to a regex (no external deps). */
function globToRegex(glob) {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function matches(glob, candidate) {
  return globToRegex(glob).test(candidate);
}

describe('swyftEslintConfig security layer', () => {
  const config = swyftEslintConfig();
  const securityBlock = config[config.length - 1];

  it('places the security block last with no files restriction', () => {
    expect(securityBlock.name).toBe('swyft/security');
    expect(securityBlock.files).toBeUndefined();
  });

  it('enforces every security rule at error', () => {
    for (const [rule, level] of Object.entries(securityRules)) {
      expect(level).toBe('error');
    }
    expect(Object.keys(securityBlock.rules).sort()).toEqual(Object.keys(securityRules).sort());
  });

  it('testFileGlobs matches spec, test.tsx and __tests__ paths', () => {
    expect(matches('**/*.spec.ts', 'apps/api/src/foo.spec.ts')).toBe(true);
    expect(matches('**/*.spec.tsx', 'apps/api/src/foo.spec.tsx')).toBe(true);
    expect(matches('**/*.test.ts', 'apps/api/src/foo.test.ts')).toBe(true);
    expect(matches('**/*.test.tsx', 'apps/api/src/foo.test.tsx')).toBe(true);
    expect(matches('**/__tests__/**', 'apps/api/src/foo/__tests__/bar.ts')).toBe(true);
    expect(matches('**/__tests__/**', 'apps/api/src/__tests__/helper.ts')).toBe(true);

    // Non-test paths must not match the test globs.
    expect(matches('**/*.spec.ts', 'apps/api/src/foo.ts')).toBe(false);
    expect(matches('**/*.spec.ts', 'apps/api/src/foo.test.ts')).toBe(false);
    expect(matches('**/__tests__/**', 'apps/api/src/foo.ts')).toBe(false);
  });
});
