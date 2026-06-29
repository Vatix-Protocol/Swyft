import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM build
  {
    entry: { index: 'src/index.ts' },
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
    entry: { index: 'src/index.ts' },
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
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: { only: true },
    outDir: 'dist/types',
    clean: false,
    external: ['@stellar/stellar-sdk'],
  },
]);
