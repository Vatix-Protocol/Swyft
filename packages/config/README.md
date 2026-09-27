# @swyft/config

Shared configuration for the Swyft monorepo. Tracking issue for enforcement: #1036.

| Export                               | What it is                                                         |
| ------------------------------------ | ------------------------------------------------------------------ |
| `@swyft/config`                      | Stellar network presets (`NETWORK_PRESETS`, passphrases, RPC URLs) |
| `@swyft/config/tsconfig.base.json`   | Strict TypeScript base every workspace extends                     |
| `@swyft/config/eslint` (`eslint.js`) | Shared ESLint flat-config layer (`swyftEslintConfig()`)            |
| `scripts/check-shared-config.mjs`    | CI gate that enforces the two above                                |

## TypeScript

Every workspace `tsconfig.json` must extend the base, directly or through a chain:

```jsonc
{ "extends": "../../packages/config/tsconfig.base.json" } // or "@swyft/config/tsconfig.base.json"
```

No workspace tsconfig may set these to `false`: `strict`, `noImplicitAny`,
`strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `noImplicitThis`, `alwaysStrict`,
`useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`. The one reviewed exception is
`strictPropertyInitialization: false` in `apps/api`, which NestJS constructor injection needs.

## ESLint

Keep framework presets (Next.js, typescript-eslint) in the app and spread the shared layer **last**,
so app rules can't weaken it:

```js
// apps/<app>/eslint.config.mjs
import swyftConfig from '../../packages/config/eslint.js';

export default [...frameworkPresets, ...appSpecificRules, ...swyftConfig.swyftEslintConfig()];
```

The layer provides:

- **Security rules at `error`**: `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url`,
  `no-debugger`
- **Shared TS rule:** `@typescript-eslint/no-unused-vars: warn`. The app preset must register the
  `@typescript-eslint` plugin.
- **Test relaxations:** `@typescript-eslint/no-explicit-any: off` in `__tests__`, `*.test.*`,
  `*.spec.*` and `*.e2e-spec.ts`
- **Shared ignores:** `node_modules`, `dist`, `coverage`, `.turbo`

`apps/api` installs this package as a `file:` copy, so both apps import `eslint.js` by relative path.
That way they always use the workspace source, not a stale installed copy.

## Enforcement

```bash
pnpm config:check                                   # from the repo root; CI runs this
node packages/config/scripts/check-shared-config.mjs --static   # skip loading ESLint
```

| Code                                     | Meaning                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `SHARED_CONFIG_TSCONFIG_MISSING`         | Non-exempt workspace has no `tsconfig.json`                                 |
| `SHARED_CONFIG_TSCONFIG_INVALID`         | tsconfig unparsable, missing `extends` target, or `extends` cycle           |
| `SHARED_CONFIG_TSCONFIG_NOT_EXTENDED`    | `extends` chain never reaches `tsconfig.base.json`                          |
| `SHARED_CONFIG_TS_STRICTNESS_DOWNGRADED` | A protected compiler option is set to `false`                               |
| `SHARED_CONFIG_ESLINT_MISSING`           | Workspace has a `lint` script but no `eslint.config.*`                      |
| `SHARED_CONFIG_ESLINT_NOT_SHARED`        | ESLint config doesn't import and spread `swyftEslintConfig()`               |
| `SHARED_CONFIG_ESLINT_UNRESOLVED`        | Workspace's ESLint or config can't be loaded (fails closed)                 |
| `SHARED_CONFIG_ESLINT_RULE_WEAKENED`     | Effective config for `src/**/*.ts` has a shared security rule below `error` |
| `SHARED_CONFIG_PACKAGE_FILE_MISSING`     | `package.json` `files`/`exports` points at a file that doesn't exist        |

The **effective** check loads each app's own ESLint and computes the final config for a probe
`src/*.ts` file. A later override like `{ rules: { 'no-eval': 'off' } }` is caught even when the
shared layer is imported.

**Deny-by-default:** every `apps/*` and `packages/*` directory with a `package.json` is checked
unless it's listed in `EXEMPT_WORKSPACES` with a reason. Today that's only `packages/contract`
(Rust/Soroban; its TS is deploy tooling run by tsx/ts-jest).

The CLI prints one JSON summary line (`event: "shared_config.check"`, `correlationId`,
`errorsByCode`). Override the id with `SHARED_CONFIG_CORRELATION_ID`. Exit codes: `0` ok,
`1` violations, `2` bad usage.

## Rollback

Lint and type config only. Nothing touches money paths or mainnet, so there is no runtime flag.
To roll back, revert the PR; the app configs return to their inline rules.

## Development

```bash
cd packages/config
pnpm test        # vitest: network presets + enforcement tests
pnpm typecheck   # tsc on src/ (vitest globals typed)
```

See also: [CONTRIBUTING.md](../../CONTRIBUTING.md#code-standards), [SECURITY.md](../../SECURITY.md),
[fixtures/README.md](../../fixtures/README.md).
