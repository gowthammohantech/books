/**
 * EmailTemplate seeding.
 *
 * EmailTemplate became TENANT-OWNED in P4: the library used to be seeded once
 * per install and shared by everyone, which meant one company editing the
 * "Invoice Generated" body changed it for every other company on the box.
 *
 * There are two entry points, and they exist for different reasons:
 *
 *   seedEmailTemplatesForTenant  -- stock ONE workspace. Called from signup
 *                                   (via prisma/seedTenant.ts), inside the
 *                                   registration transaction.
 *   seedEmailTemplates           -- replay the library across EVERY tenant.
 *                                   This is the boot-time reconciliation, and
 *                                   it is what makes a release that ADDS a
 *                                   template reach companies that already
 *                                   exist. Same role seedRoles.ts plays for
 *                                   newly-added Modules.
 *
 * Idempotent by (tenantId, notificationTypeId, title) -- now a real unique
 * index, so the pre-check below is belt-and-braces rather than the whole
 * mechanism.
 *
 * Run: `npx ts-node prisma/seedEmailTemplates.ts` (or via the boot seed flow).
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { TEMPLATES } from './data/emailTemplates';

const prisma = new PrismaClient();

export interface SeedEmailTemplatesResult {
  created: number;
  skipped: number;
}

/** Client slice this seeder needs, so it can run inside a caller's transaction. */
export type EmailTemplateSeedDb = Pick<PrismaClient, 'notificationType' | 'emailTemplate'>;

export async function seedEmailTemplatesForTenant(
  tenantId: string,
  db: EmailTemplateSeedDb = prisma,
): Promise<SeedEmailTemplatesResult> {
  // Three queries for the whole library, not three PER TEMPLATE. This runs
  // inside the signup transaction (see prisma/seedTenant.ts), and a round trip
  // per template was the largest single contributor to the 5s
  // interactive-transaction timeout that failed registrations with P2028.
  const types = await db.notificationType.findMany({
    where: { slug: { in: TEMPLATES.map((t) => t.typeSlug) } },
    select: { id: true, slug: true },
  });
  const typeIdBySlug = new Map(types.map((t) => [t.slug, t.id]));

  const existing = await db.emailTemplate.findMany({
    where: { tenantId, title: { in: TEMPLATES.map((t) => t.title) } },
    select: { notificationTypeId: true, title: true },
  });
  // The idempotency key is (tenantId, notificationTypeId, title) — the same
  // unique index the row-at-a-time findFirst was checking.
  const key = (typeId: string, title: string) => `${typeId}|${title}`;
  const have = new Set(existing.map((e) => key(e.notificationTypeId, e.title)));

  let skipped = 0;
  const toCreate: Prisma.EmailTemplateCreateManyInput[] = [];

  for (const t of TEMPLATES) {
    const typeId = typeIdBySlug.get(t.typeSlug);
    if (!typeId) {
      // Notification types are seeded earlier; skip gracefully if missing.
      skipped += 1;
      continue;
    }
    if (have.has(key(typeId, t.title))) {
      skipped += 1;
      continue;
    }
    // Guards against a duplicate inside TEMPLATES itself, which createMany
    // would turn into a unique-constraint failure rather than a skip.
    have.add(key(typeId, t.title));
    toCreate.push({
      tenantId,
      title: t.title,
      notificationTypeId: typeId,
      description: t.description,
      subject: t.subject,
      sms_content: t.sms_content,
      notification_content: t.notification_content,
      status: 'active',
    });
  }

  if (toCreate.length > 0) {
    await db.emailTemplate.createMany({ data: toCreate });
  }

  return { created: toCreate.length, skipped };
}

export async function seedEmailTemplates(): Promise<SeedEmailTemplatesResult> {
  let created = 0;
  let skipped = 0;

  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  for (const t of tenants) {
    const r = await seedEmailTemplatesForTenant(t.id);
    created += r.created;
    skipped += r.skipped;
  }

  return { created, skipped };
}

if (require.main === module) {
  seedEmailTemplates()
    .then((r) => {
      console.log(`Email templates seeded (created ${r.created}, skipped ${r.skipped}).`);
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('seedEmailTemplates error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
