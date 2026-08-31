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
import { PrismaClient } from '@prisma/client';

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
  let created = 0;
  let skipped = 0;

  for (const t of TEMPLATES) {
    const type = await db.notificationType.findUnique({ where: { slug: t.typeSlug } });
    if (!type) {
      // Notification types are seeded earlier; skip gracefully if missing.
      skipped += 1;
      continue;
    }

    const existing = await db.emailTemplate.findFirst({
      where: { tenantId, notificationTypeId: type.id, title: t.title },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await db.emailTemplate.create({
      data: {
        tenantId,
        title: t.title,
        notificationTypeId: type.id,
        description: t.description,
        subject: t.subject,
        sms_content: t.sms_content,
        notification_content: t.notification_content,
        status: 'active',
      },
    });
    created += 1;
  }

  return { created, skipped };
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
