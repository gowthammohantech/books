/**
 * Regression test for the two tenant-isolation ESLint guards in
 * eslint.config.mjs. Both are `error`-level and both are path-sensitive, so a
 * refactor that moves files can disable them without anything failing — the
 * lint run simply stops reporting. This asserts they still fire.
 *
 * The `requireUserId` guard previously enumerated four hardcoded relative
 * prefixes ('./tenantScope' .. '../../../lib/tenantScope'); a file one level
 * deeper slipped past it. The deep fixture below is that case.
 */
import path from 'path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const API_ROOT = path.resolve(__dirname, '..');

async function lint(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: API_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(API_ROOT, filePath),
  });
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => m.ruleId ?? '');
}

describe('tenant-isolation ESLint guards', () => {
  it('rejects requireUserId imported from any depth', async () => {
    const rules = await lint(
      `import { requireUserId } from '../../../../lib/tenantScope';\nexport const x = requireUserId;\n`,
      'controllers/Admin/AI/nested/deep.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects requireUserId imported from a sibling tenantScope', async () => {
    const rules = await lint(
      `import { requireUserId } from './tenantScope';\nexport const x = requireUserId;\n`,
      'lib/somewhere.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects raw SQL outside the allowed files', async () => {
    const rules = await lint(
      "import { prisma } from '../lib/prisma';\nexport const bad = () => prisma.$queryRaw`SELECT 1`;\n",
      'controllers/someController.ts',
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('still allows raw SQL inside prisma/**', async () => {
    const rules = await lint(
      "import { prisma } from '../lib/prisma';\nexport const ok = () => prisma.$queryRaw`SELECT 1`;\n",
      'prisma/someBackfill.ts',
    );
    expect(rules).not.toContain('no-restricted-syntax');
  });

  it('still allows raw SQL inside the guard implementation itself', async () => {
    const rules = await lint(
      "import { prisma } from './prisma';\nexport const ok = () => prisma.$queryRaw`SELECT 1`;\n",
      'lib/tenantGuard.ts',
    );
    expect(rules).not.toContain('no-restricted-syntax');
  });
});
