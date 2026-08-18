import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    include: ['tests/**/*.test.ts', 'lib/**/*.spec.ts', 'controllers/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Register ts-node before test files run so that plain-JS CJS controllers
    // (e.g. externalController.js) can require TS source files at test time.
    setupFiles: ['./tests/setup-tsnode.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'dist/', 'coverage/', 'tests/'],
    },
    testTimeout: 10_000,
  },
});
