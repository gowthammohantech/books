import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

// The frontend had `"test": "vitest run"` and vitest installed but no config at
// all, so it ran entirely on defaults. This makes the setup explicit and
// inherits the path aliases from vite.config.ts, so tests resolve @/,
// @components/ etc. the same way the app does.
//
// `environment` stays 'node' deliberately: all 9 current suites are pure logic
// (src/lib, src/utils) and neither jsdom nor @testing-library is installed.
// Adding component tests for the 298 .tsx files means installing jsdom and
// switching this to 'jsdom' — a real piece of work, tracked separately.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      globals: false,
      clearMocks: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        exclude: ['node_modules/', 'dist/', 'coverage/', 'public/'],
      },
    },
  }),
);
