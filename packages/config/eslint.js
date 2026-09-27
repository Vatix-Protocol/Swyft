/**
 * @swyft/config/eslint — shared ESLint flat-config layer (issue #1036).
 *
 * Framework presets (Next.js, NestJS/typescript-eslint) stay in each app; this
 * layer holds the rules every workspace must share. Spread it LAST so an app
 * cannot silently weaken a shared rule:
 *
 * @example
 * ```js
 * // eslint.config.mjs
 * import swyftConfig from '../../packages/config/eslint.js';
 * export default [...frameworkPresets, ...appRules, ...swyftConfig.swyftEslintConfig()];
 * ```
 *
 * `node packages/config/scripts/check-shared-config.mjs` (CI) fails if a lint
 * workspace does not use this layer or ends up with a weaker effective rule.
 *
 * This file is CommonJS with no plugin imports so any workspace can load it
 * regardless of which ESLint plugins it has installed.
 */

/** Paths no workspace should lint (build output, caches, vendored deps). */
const sharedIgnores = Object.freeze([
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.turbo/**',
]);

/** Test files, where typing rules are relaxed for mocks and fixtures. */
const testFileGlobs = Object.freeze([
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.e2e-spec.ts',
]);

/**
 * Security rules enforced at `error` in every workspace. Code-injection sinks
 * are never acceptable on money paths, so these are not overridable.
 */
const securityRules = Object.freeze({
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-debugger': 'error',
});

/** TypeScript rules shared by every workspace (plugin registered by the app preset). */
const typescriptRules = Object.freeze({
  '@typescript-eslint/no-unused-vars': 'warn',
});

/** Relaxations that apply to test files only. */
const testRules = Object.freeze({
  '@typescript-eslint/no-explicit-any': 'off',
});

/** Returns the shared flat-config objects. Spread after framework presets. */
function swyftEslintConfig() {
  return [
    { name: 'swyft/ignores', ignores: [...sharedIgnores] },
    { name: 'swyft/typescript', rules: { ...typescriptRules } },
    { name: 'swyft/tests', files: [...testFileGlobs], rules: { ...testRules } },
    // Security last so nothing above (or before) can downgrade it.
    { name: 'swyft/security', rules: { ...securityRules } },
  ];
}

module.exports = {
  securityRules,
  sharedIgnores,
  swyftEslintConfig,
  testFileGlobs,
  testRules,
  typescriptRules,
};
