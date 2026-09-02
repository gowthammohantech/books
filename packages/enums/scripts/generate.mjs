#!/usr/bin/env node
/**
 * Generates src/generated.ts from apps/api/prisma/schema.prisma.
 *
 * These enums were previously hand-copied into apps/web/src/types/*.ts as
 * string-literal unions. Hand-copied means drift, and drift in an enum that
 * gates accounting behaviour is silent: the UI simply stops offering a value,
 * or sends one the API rejects. Generating removes the possibility.
 *
 * Only the enums listed in ENUMS below are emitted — the schema has 84, and
 * most are backend-only. Add a name here when the frontend needs it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(here, '../../../apps/api/prisma/schema.prisma');
const OUT = resolve(here, '../src/generated.ts');

/** Enums the frontend needs. Everything else stays backend-only. */
const ENUMS = [
  'AccountType',
  'BankTransactionRelatedType',
  'BusinessType',
  'BankTransactionType',
  'CategoryAppliesTo',
  'GatewayKind',
  'InvoiceStatus',
  'LeavePortion',
  'LeaveStatus',
  'PaymentTransactionStatus',
  'PurchaseStatus',
  'ProjectMemberRole',
  'RecurrenceCustomIntervalType',
  'RecurrenceFrequency',
  'RecurringScheduleStatus',
  'TaxKind',
  'TaxRegime',
  'TaxTreatment',
  'TimesheetStatus',
];

function parseEnums(schema) {
  const found = new Map();
  const re = /^enum\s+(\w+)\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(schema))) {
    const members = m[2]
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l && /^[A-Za-z_]\w*$/.test(l));
    found.set(m[1], members);
  }
  return found;
}

const all = parseEnums(readFileSync(SCHEMA, 'utf8'));
const missing = ENUMS.filter((n) => !all.has(n));
if (missing.length) {
  console.error(`[enums] not found in schema.prisma: ${missing.join(', ')}`);
  process.exit(1);
}

const parts = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// Run `npm run generate --workspace=@elixirbooks/enums` after changing',
  '// apps/api/prisma/schema.prisma. CI fails if this file is out of date.',
  '',
];
for (const name of ENUMS) {
  const members = all.get(name);
  parts.push(`/** Mirrors the Prisma \`${name}\` enum. */`);
  parts.push(`export type ${name} =`);
  parts.push(members.map((v) => `  | '${v}'`).join('\n') + ';');
  parts.push('');
  parts.push(`export const ${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_VALUES = [`);
  parts.push(members.map((v) => `  '${v}',`).join('\n'));
  parts.push(`] as const satisfies readonly ${name}[];`);
  parts.push('');
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, parts.join('\n'));
console.log(`[enums] wrote ${ENUMS.length} enums to ${OUT}`);
