/**
 * Per-company seeder — aim the full demo dataset at any workspace.
 *
 *   npx ts-node prisma/seedCompany.ts --company "Acme Ltd" --create --confirm
 *   npx ts-node prisma/seedCompany.ts --list-tenants
 *
 * WHY THIS EXISTS. prisma/seed-demo-full.ts builds a complete, realistic
 * dataset — customers, invoices with real GL postings, purchases, expenses,
 * banking, time tracking, the lot — but it could only ever build it for one
 * hardcoded account. This file is the front door that lets it be pointed at a
 * company named on the command line, creating that company first if absent.
 *
 * DESTRUCTIVE. Seeding a workspace WIPES the business data it already holds:
 * invoices, purchases, contacts, accounts, journal entries, and every non-owner
 * staff user. That is inherent to the engine, which reseeds rather than merges.
 * So this runs as a DRY RUN unless `--confirm` is passed — the same convention
 * prisma/clear-demo.ts uses. A dry run resolves the tenant, reports exactly
 * what would be deleted, and writes nothing.
 *
 * Exit codes are a contract with scripts/seed_company.py:
 *   0 ok · 1 unexpected error · 2 tenant not found · 3 ambiguous name
 *   4 bad argument · 5 refused
 */

import { PrismaClient } from '@prisma/client';

import { provisionTenant, PROVISION_TX_OPTIONS } from '../lib/tenantProvisioning';
import { hashPassword } from '../utils/password';

import { seedDemoFull } from './seed-demo-full';

const prisma = new PrismaClient();

export const EXIT = {
  OK: 0,
  ERROR: 1,
  NOT_FOUND: 2,
  AMBIGUOUS: 3,
  BAD_ARG: 4,
  REFUSED: 5,
} as const;

/** applyPack ships packs for six countries; the demo CONTENT is India-only. */
const SUPPORTED_COUNTRIES = ['IN'];

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Hand-rolled rather than pulling in a parser: prisma/clear-demo.ts already
 * reads process.argv directly, and a dependency for six flags is not worth it.
 * Accepts both `--k=v` and `--k v`.
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// ---------------------------------------------------------------------------
// tenant resolution
// ---------------------------------------------------------------------------

export interface ResolvedTenant {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  ownerEmail: string;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  memberships: { userId: string; user: { email: string } }[];
}

const OWNER_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  memberships: {
    where: { isOwner: true },
    take: 1,
    select: { userId: true, user: { select: { email: true } } },
  },
} as const;

/**
 * Match on id, then slug, then case-insensitive exact name. Deliberately NOT a
 * substring match: `--company Acme` must not silently pick "Acme Holdings".
 *
 * Returns every name match rather than the first, so the caller can refuse an
 * ambiguous one instead of seeding — and therefore wiping — whichever row
 * happened to sort first. Workspaces sharing a name is not hypothetical; three
 * of the four on this install do.
 */
export async function findTenants(needle: string): Promise<TenantRow[]> {
  const byId = await prisma.tenant.findFirst({
    where: { id: needle, deletedAt: null },
    select: OWNER_SELECT,
  });
  if (byId) return [byId as TenantRow];

  const bySlug = await prisma.tenant.findFirst({
    where: { slug: needle, deletedAt: null },
    select: OWNER_SELECT,
  });
  if (bySlug) return [bySlug as TenantRow];

  const byName = await prisma.tenant.findMany({
    where: { name: { equals: needle, mode: 'insensitive' }, deletedAt: null },
    select: OWNER_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  return byName as TenantRow[];
}

const HEADER = ['id', 'name', 'slug', 'status', 'created', 'owner'];

function describe(t: TenantRow): string {
  const owner = t.memberships[0]?.user.email ?? '(no owner)';
  return [t.id, t.name, t.slug, t.status, t.createdAt.toISOString().slice(0, 10), owner].join('\t');
}

async function listTenants(toStderr = false): Promise<void> {
  const rows = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: OWNER_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const write = toStderr ? console.error : console.log;
  write(HEADER.join('\t'));
  for (const r of rows) write(describe(r as TenantRow));
}

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------

/**
 * Create the workspace through the SAME code signup uses
 * (lib/tenantProvisioning.provisionTenant), so a seeded company and a
 * registered one are the same shape by construction — same roles, same
 * permissions, same owner membership, same per-tenant defaults.
 */
async function createCompany(opts: {
  companyName: string;
  ownerEmail?: string;
  ownerPassword: string;
}): Promise<ResolvedTenant> {
  const existingOwner = opts.ownerEmail
    ? await prisma.user.findUnique({ where: { email: opts.ownerEmail } })
    : null;

  return prisma.$transaction(async (tx) => {
    const client = tx as unknown as PrismaClient;

    let ownerUserId: string;
    let ownerEmail: string;
    if (existingOwner) {
      ownerUserId = existingOwner.id;
      ownerEmail = existingOwner.email;
    } else {
      // The owner has to exist before provisionTenant can attach a membership,
      // so the placeholder address is derived from the company name the same
      // way uniqueSlug derives the slug.
      const stem =
        opts.companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'workspace';
      ownerEmail = opts.ownerEmail ?? `owner@${stem}.seed.local`;
      const created = await client.user.create({
        data: {
          firstName: 'Owner',
          lastName: opts.companyName.slice(0, 40),
          email: ownerEmail,
          password: await hashPassword(opts.ownerPassword),
          user_type: 1,
          isDeleted: false,
        },
      });
      ownerUserId = created.id;
    }

    const tenant = await provisionTenant(client, {
      ownerUserId,
      companyName: opts.companyName,
    });
    await client.user.update({ where: { id: ownerUserId }, data: { lastTenantId: tenant.id } });

    return { id: tenant.id, name: tenant.name, slug: tenant.slug, ownerUserId, ownerEmail };
  }, PROVISION_TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// dry run
// ---------------------------------------------------------------------------

/**
 * What the wipe would destroy. Not exhaustive — it is the headline set a person
 * needs in order to recognise "that is my real company, stop". Anything
 * non-zero here on a workspace you care about means do not pass --confirm.
 */
async function previewDestruction(tenantId: string): Promise<Record<string, number>> {
  const [invoices, purchases, expenses, contacts, customers, accounts, journalEntries, staff] =
    await Promise.all([
      prisma.invoice.count({ where: { tenantId } }),
      prisma.purchase.count({ where: { tenantId } }),
      prisma.expense.count({ where: { tenantId } }),
      prisma.contact.count({ where: { tenantId } }),
      prisma.customer.count({ where: { tenantId } }),
      prisma.account.count({ where: { tenantId } }),
      prisma.journalEntry.count({ where: { tenantId } }),
      prisma.tenantMembership.count({ where: { tenantId, isOwner: false } }),
    ]);
  return {
    invoices,
    purchases,
    expenses,
    contacts,
    customers,
    accounts,
    journalEntries,
    staffUsers: staff,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface Envelope {
  ok: boolean;
  action: string;
  tenant?: { id: string; name: string; slug: string; ownerEmail: string };
  counts?: Record<string, number>;
  wouldDelete?: Record<string, number>;
  error?: string;
}

/**
 * The JSON envelope is the LAST line of stdout, so the Python wrapper can take
 * splitlines()[-1] without having to disentangle it from the progress log.
 */
function emit(json: boolean, env: Envelope): void {
  if (json) console.log(JSON.stringify(env));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const json = args.json === true;

  if (args['list-tenants']) {
    await listTenants();
    return EXIT.OK;
  }

  const company = str(args.company);
  if (!company) {
    console.error('--company <id|name|slug> is required (or --list-tenants).');
    return EXIT.BAD_ARG;
  }

  const country = (str(args.country) ?? 'IN').toUpperCase();
  if (!SUPPORTED_COUNTRIES.includes(country)) {
    console.error(
      `--country ${country} is not supported yet. lib/ledger/packs ships charts of\n` +
        'accounts for six countries, but the seeded CONTENT is India-only — GST_INDIA\n' +
        'tax regime, CGST/SGST/IGST rates, Indian addresses — so any other country\n' +
        'would staple a foreign chart of accounts onto Indian documents.\n' +
        `Supported: ${SUPPORTED_COUNTRIES.join(', ')}.`,
    );
    return EXIT.BAD_ARG;
  }

  const confirm = args.confirm === true || process.env.CONFIRM === 'yes';
  const matches = await findTenants(company);

  if (matches.length > 1) {
    console.error(`"${company}" matches ${matches.length} workspaces. Refusing to guess.\n`);
    console.error(HEADER.join('\t'));
    for (const m of matches) console.error(describe(m));
    console.error('\nRe-run with --company <id>, naming exactly the one you mean.');
    emit(json, { ok: false, action: 'ambiguous', error: `${matches.length} matches` });
    return EXIT.AMBIGUOUS;
  }

  let target: ResolvedTenant;

  if (matches.length === 0) {
    if (!args.create) {
      console.error(`No workspace matches "${company}". Pass --create to make it.\n`);
      await listTenants(true);
      emit(json, { ok: false, action: 'not-found', error: company });
      return EXIT.NOT_FOUND;
    }
    if (!confirm) {
      console.log(`DRY RUN — would CREATE workspace "${company}" and seed every module.`);
      console.log('Nothing exists under that name, so nothing would be destroyed.');
      console.log('\nRe-run with --confirm to do it.');
      emit(json, { ok: true, action: 'dry-run-create' });
      return EXIT.OK;
    }
    target = await createCompany({
      companyName: company,
      ownerEmail: str(args['owner-email']),
      ownerPassword: str(args['owner-password']) ?? 'Demo123$',
    });
    console.log(`Created workspace ${target.name} (${target.slug}) owned by ${target.ownerEmail}`);
  } else {
    const t = matches[0];
    const owner = t.memberships[0];
    if (!owner) {
      // Every User FK the seeder writes (billFrom, received_by, createdBy,
      // reconciledBy) needs a real person. prisma/seedTenant.ts skips ownerless
      // tenants for the same reason rather than inventing one.
      console.error(
        `Workspace ${t.name} (${t.slug}) has no owner membership. The seeder writes an\n` +
          'owner id into billFrom, received_by, createdBy and reconciledBy, and there is\n' +
          'no honest value to use. Give it an owner first.',
      );
      emit(json, { ok: false, action: 'refused', error: 'no owner' });
      return EXIT.REFUSED;
    }
    target = {
      id: t.id,
      name: t.name,
      slug: t.slug,
      ownerUserId: owner.userId,
      ownerEmail: owner.user.email,
    };

    const doomed = await previewDestruction(t.id);
    const total = Object.values(doomed).reduce((a, b) => a + b, 0);

    if (!confirm) {
      console.log('DRY RUN — would seed every module into an EXISTING workspace:\n');
      console.log(`  ${target.name}  (slug ${target.slug}, id ${target.id})`);
      console.log(`  owner: ${target.ownerEmail}\n`);
      if (total === 0) {
        console.log('  It holds no business data — nothing would be destroyed.');
      } else {
        console.log('  These rows would be DELETED and replaced:');
        for (const [k, v] of Object.entries(doomed)) {
          if (v > 0) console.log(`    ${k.padEnd(16)} ${v}`);
        }
      }
      console.log('\nRe-run with --confirm to do it.');
      emit(json, {
        ok: true,
        action: 'dry-run-seed',
        tenant: {
          id: target.id,
          name: target.name,
          slug: target.slug,
          ownerEmail: target.ownerEmail,
        },
        wouldDelete: doomed,
      });
      return EXIT.OK;
    }

    if (total > 0) {
      console.log(`Wiping ${total} existing row(s) in ${target.name} before reseeding.`);
    }
  }

  console.log(`Seeding ${target.name} (${target.slug}) — tenantId=${target.id}`);
  console.log('-'.repeat(60));

  const counts = await seedDemoFull({
    tenantId: target.id,
    ownerUserId: target.ownerUserId,
    tenantSlug: target.slug,
    companyName: target.name,
  });

  console.log('-'.repeat(60));
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log('-'.repeat(60));
  console.log(`Owner login: ${target.ownerEmail}`);

  emit(json, {
    ok: true,
    action: 'seeded',
    tenant: { id: target.id, name: target.name, slug: target.slug, ownerEmail: target.ownerEmail },
    counts,
  });
  return EXIT.OK;
}

if (require.main === module) {
  main()
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (err) => {
      console.error('seedCompany failed:', err);
      await prisma.$disconnect();
      process.exit(EXIT.ERROR);
    });
}
