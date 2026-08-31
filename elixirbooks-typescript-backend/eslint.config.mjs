// ESLint 9 flat config. `.mjs` so we can use ESM imports in a CommonJS project.
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'prisma/migrations/**',
      'uploads/**',
      // Existing JS files are not linted in slice 0.1c. They'll be deleted or
      // converted as their controllers are migrated in 0.1d/e/f.
      '**/*.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
        },
      ],
      'import/no-duplicates': 'error',

      // ----------------------------------------------------------------
      // Tenant isolation (P6). These make the two ways AROUND the tenant
      // guard visible at review time instead of at incident time.
      // ----------------------------------------------------------------

      // Raw SQL does not go through Prisma's `$allModels` interceptor, so
      // lib/tenantGuard.ts cannot see it and cannot scope it — it is the one
      // hole in the guard that no amount of care inside the extension closes.
      // Allowed in prisma/** (migrations and backfills are cross-tenant by
      // nature); anywhere else it has to be argued for explicitly with a
      // disable comment.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]",
          message:
            'Raw SQL bypasses the tenant guard entirely (lib/tenantGuard.ts limitation 4). ' +
            'Use the Prisma query API, or move this into prisma/** if it is a ' +
            'genuinely cross-tenant migration or backfill.',
        },
      ],

      // `requireUserId` is the pre-P3 name for `requireTenantId`. It returns a
      // TENANT id and never returned the acting user's id — a mismatch that
      // already caused real bugs (reminderController compared it against
      // `createdBy`). The alias is removed in P9.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './tenantScope',
              importNames: ['requireUserId'],
              message:
                'Deprecated: use requireTenantId for data scoping, or ' +
                'requireActingUserId when you actually want the person.',
            },
            {
              name: '../lib/tenantScope',
              importNames: ['requireUserId'],
              message:
                'Deprecated: use requireTenantId for data scoping, or ' +
                'requireActingUserId when you actually want the person.',
            },
            {
              name: '../../lib/tenantScope',
              importNames: ['requireUserId'],
              message:
                'Deprecated: use requireTenantId for data scoping, or ' +
                'requireActingUserId when you actually want the person.',
            },
            {
              name: '../../../lib/tenantScope',
              importNames: ['requireUserId'],
              message:
                'Deprecated: use requireTenantId for data scoping, or ' +
                'requireActingUserId when you actually want the person.',
            },
          ],
        },
      ],
    },
  },
  {
    // prisma/** is where cross-tenant work legitimately lives: schema
    // migrations, one-off backfills and the platform seed all operate across
    // every workspace by definition, and several of them need raw SQL to do it.
    files: ['prisma/**'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // lib/prisma.ts defines `prismaUnscoped`; lib/tenantGuard.ts and
    // lib/auditExtension.ts implement the guard itself. Neither can be written
    // in terms of the rule it enforces.
    files: ['lib/prisma.ts', 'lib/tenantGuard.ts', 'lib/auditExtension.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
