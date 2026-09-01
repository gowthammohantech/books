import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  // public/ is vendored third-party static assets for the landing and
  // documentation sites — jQuery, Bootstrap, Font Awesome, ~22k lines, over
  // half of it minified. It is served as-is by nginx and never compiled.
  // Without this, widening any lint glob to .js sets ESLint parsing all of it.
  globalIgnores(['dist', 'public', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // Was ecmaVersion 2020, which contradicted tsconfig's target: ES2022.
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // Matches the policy apps/api already sets explicitly. Both are real
      // debt (344 anys, 95 unused bindings here) but they are pre-existing and
      // pervasive; as errors they drown the genuine findings below and make a
      // green CI impossible. Tracked for the strictness ratchet.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Fires on the four context modules that export a provider component
      // alongside its consumer hook — the conventional React pattern. It is a
      // Fast Refresh ergonomics rule (an edit to one of those files does a full
      // reload instead of a hot swap), not a correctness one, so it should not
      // fail a build; splitting each context in two is not worth it here.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Node-context tooling: vite config and the design-token guard script.
    files: ['vite.config.ts', 'vitest.config.ts', 'scripts/**/*.{js,mjs,ts}', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
])
