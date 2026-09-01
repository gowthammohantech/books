/**
 * Guards the whole point of this package: that the generated unions still match
 * apps/api/prisma/schema.prisma. Regenerating is a manual step, so without this
 * the file would drift exactly the way the hand-copied frontend unions did.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TAX_REGIME_VALUES, ACCOUNT_TYPE_VALUES } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATED = resolve(here, 'generated.ts');
const SCRIPT = resolve(here, '../scripts/generate.mjs');

/**
 * Line endings are not drift.
 *
 * .editorconfig declares `end_of_line = lf` and the generator writes LF, but
 * there is no .gitattributes — so a clone with `core.autocrlf=true` (the
 * Windows default) checks the file out as CRLF. Comparing raw bytes then fails
 * on every Windows machine no matter what the schema says, which is a false
 * alarm that trains people to ignore this guard. Compare the content.
 */
const normalize = (source: string): string =>
  source.split('\r\n').join('\n');

describe('generated enums', () => {
  it('is up to date with schema.prisma', () => {
    const before = readFileSync(GENERATED, 'utf8');
    execFileSync('node', [SCRIPT], { stdio: 'pipe' });
    const after = readFileSync(GENERATED, 'utf8');
    // Put the file back the way the checkout had it, so a passing run leaves no
    // spurious modification behind for the next `git status`.
    writeFileSync(GENERATED, before);
    expect(
      normalize(after),
      'src/generated.ts is stale — run `npm run generate --workspace=@elixirbooks/enums`',
    ).toBe(normalize(before));
  });

  it('carries the tax regimes the frontend union used to be missing', () => {
    // The hand-written apps/web union listed only the first four. A tenant on
    // UK/EU VAT or AU/NZ GST had a regime the frontend did not model.
    expect(TAX_REGIME_VALUES).toEqual([
      'GST_INDIA',
      'VAT_GENERIC',
      'US_SALES_TAX',
      'NONE',
      'VAT_UK',
      'VAT_EU',
      'GST_AU',
      'GST_NZ',
    ]);
  });

  it('exposes runtime value arrays, not just types', () => {
    expect(ACCOUNT_TYPE_VALUES).toEqual(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
  });
});
