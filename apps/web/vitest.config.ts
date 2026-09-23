import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@swyft/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@swyft/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@swyft/sdk': path.resolve(__dirname, '../../packages/sdk/src/index.ts'),
    },
  },
});
