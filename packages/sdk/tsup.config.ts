import { defineConfig } from 'tsup';

// Each submodule gets its own entry so consumers can either import the
// `.` barrel or reach a single module directly (e.g. `@swyft/sdk/swap`).
// Subpath imports guarantee unused modules never enter the bundle, even
// under bundlers/runtimes that don't tree-shake a barrel file well (or
// CJS `require`, which can't tree-shake at all).
const entry = {
  index: 'src/index.ts',
  quote: 'src/quote.ts',
  liquidity: 'src/liquidity.ts',
  queries: 'src/queries.ts',
  swap: 'src/swap.ts',
  types: 'src/types.ts',
  config: 'src/config.ts',
};

export default defineConfig([
  // ESM build
  {
    entry,
    format: ['esm'],
    dts: false,
    outDir: 'dist/esm',
    sourcemap: true,
    clean: false,
    treeshake: true,
    splitting: false,
    external: ['@stellar/stellar-sdk'],
    esbuildOptions(options) {
      options.target = 'es2020';
    },
  },
  // CJS build
  {
    entry,
    format: ['cjs'],
    dts: false,
    outDir: 'dist/cjs',
    sourcemap: true,
    clean: false,
    treeshake: true,
    splitting: false,
    external: ['@stellar/stellar-sdk'],
    esbuildOptions(options) {
      options.target = 'es2020';
    },
  },
  // Type declarations only
  {
    entry,
    format: ['esm'],
    dts: { only: true },
    outDir: 'dist/types',
    clean: false,
    external: ['@stellar/stellar-sdk'],
  },
]);
