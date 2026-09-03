import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    // An allow-list, not a glob over the tree: a spec in a directory missing
    // from this line is type-checked and never run, so the suite goes green
    // having executed nothing. `core/` and `config/` are listed for that reason.
    include: [
      'tests/**/*.test.ts',
      'lib/**/*.spec.ts',
      'controllers/**/*.spec.ts',
      'prisma/**/*.spec.ts',
      'core/**/*.spec.ts',
      'config/**/*.spec.ts',
    ],
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
