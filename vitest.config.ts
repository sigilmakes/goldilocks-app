import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./apps/gateway/test/setup.ts'],
    include: [
      'apps/**/test/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      'apps/frontend/src/**/*.test.ts',
    ],
    exclude: ['node_modules/**'],
    reporters: process.env.CI ? ['verbose'] : ['default'],
  },
});
