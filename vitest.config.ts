import { defineConfig } from 'vitest/config';
import { join } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@untongue/provider-adapter': join(__dirname, 'packages/provider-adapter/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    env: { VITEST: 'true' },
  },
});
