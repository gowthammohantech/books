/**
 * Static scan for Prisma queries on tenant-owned models that carry no tenant
 * filter.
 *
 * WHY A SCANNER AND NOT A REVIEW: `lib/tenantGuard.ts` catches this at runtime,
 * but it ships in `warn` mode, so in practice it writes a log line and serves
 * the row anyway. And a missing `tenantId` produces no type error — the field
 * is optional on every `where` — so nothing else in the toolchain sees it. The
 * quotation domain shipped five handlers that resolved a document by id alone;
 * a capture proved all five served other tenants' data. This finds that shape
 * everywhere without needing a fixture per domain.
 *
 * HOW IT DECIDES. Brace-matching, not line matching: it finds each
 * `prisma.<model>.<op>({ … })`, extracts the balanced `where` block, and treats
 * the call as scoped when that block mentions `tenantId`, a `tenant` relation,
 * a `scope` variable, or a spread (which is how `tenantScope(req)` is applied).
 * The tenant-owned model list comes from the Prisma DMMF — every model with a
 * `tenantId` field — so it cannot drift from the schema.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG: a write whose `where` is just `{ id }`
 * immediately after a scoped read. That is a TOCTOU window rather than a leak,
 * and there are ~190 of them; folding them in would bury the reads, which are
 * the ones that actually serve foreign data. `--all` shows them.
 *
 * Run:  npx ts-node scripts/scanTenantScope.ts [--all] [--json]
 * Used by tests/tenant/scopeBaseline.test.ts to keep the count from growing.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import { Prisma } from '@prisma/client';

const READ_OPS = new Set(['findUnique', 'findFirst']);
const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const OPS = new Set([...READ_OPS, ...WRITE_OPS, 'findMany', 'count', 'aggregate', 'groupBy']);

/** Every model with a tenantId column, straight from the schema. */
export const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
    .map((m) => m.name),
);

export interface Finding {
  file: string;
  line: number;
  model: string;
  op: string;
  where: string;
  /** A read whose only filter is the id — the shape that serves foreign rows. */
  idOnlyRead: boolean;
}

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(p, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Index of the `}` closing the `{` at `open`. -1 if unbalanced. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const SCOPED = /tenantId|tenant\s*:|scope|\.\.\./;
/** Filter keys that do not narrow to a row: operators, not columns. */
const OPERATORS = new Set(['mode', 'not', 'equals', 'contains', 'gte', 'lte', 'gt', 'lt', 'in']);

function isIdOnly(where: string): boolean {
  if (!where.startsWith('{')) return false;
  const keys = [...where.slice(1, -1).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
    .map((m) => m[1])
    .filter((k) => !OPERATORS.has(k));
  return keys.includes('id') && keys.every((k) => k === 'id' || k === 'isDeleted' || k === 'deletedAt');
}

export function scan(roots: string[], cwd = process.cwd()): Finding[] {
  const findings: Finding[] = [];
  for (const root of roots) {
    for (const file of tsFiles(root)) {
      const src = readFileSync(file, 'utf8');
      const call = /\b(?:prisma|tx|db|client)\s*\.\s*([a-zA-Z][A-Za-z0-9_]*)\s*\.\s*([a-zA-Z]+)\s*\(\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = call.exec(src)) !== null) {
        const [, delegate, op] = m;
        const model = delegate[0].toUpperCase() + delegate.slice(1);
        if (!TENANT_MODELS.has(model) || !OPS.has(op)) continue;

        const open = src.indexOf('{', m.index + m[0].length - 1);
        const close = matchBrace(src, open);
        if (close < 0) continue;
        const args = src.slice(open, close + 1);

        const whereAt = args.search(/\bwhere\s*:\s*\{/);
        let where: string;
        if (whereAt >= 0) {
          const wo = args.indexOf('{', whereAt);
          where = args.slice(wo, matchBrace(args, wo) + 1);
        } else if (/\bwhere\s*:/.test(args)) {
          // `where: someVariable` — assume the variable carries the scope.
          where = args.slice(args.search(/\bwhere\s*:/)).split('\n')[0];
        } else {
          where = '';
        }
        if (where && SCOPED.test(where)) continue;

        findings.push({
          file: relative(cwd, file),
          line: src.slice(0, m.index).split('\n').length,
          model,
          op,
          where: where ? where.replace(/\s+/g, ' ').slice(0, 90) : '(no where)',
          idOnlyRead: READ_OPS.has(op) && isIdOnly(where.replace(/\s+/g, ' ')),
        });
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (require.main === module) {
  const all = process.argv.includes('--all');
  const found = scan(['controllers', 'lib', 'services'].filter((d) => {
    try { readdirSync(d); return true; } catch { return false; }
  }));
  const shown = all ? found : found.filter((f) => f.idOnlyRead);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(shown, null, 2));
  } else {
    for (const f of shown) {
      console.log(`${f.file}:${f.line}  ${f.model}.${f.op}  ${f.where}`);
    }
    console.log(`\n${shown.length} shown; ${found.length} unscoped call sites in total.`);
  }
}
