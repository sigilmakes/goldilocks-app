import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'frontend/**/*.test.ts'],
    exclude: ['node_modules/**'],
    reporters: process.env.CI ? ['verbose'] : ['default'],
  },
});