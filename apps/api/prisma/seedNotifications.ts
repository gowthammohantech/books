/**
 * Postgres/Prisma seed for notification types + tags.
 *
 * Replaces the legacy MongoDB `seedNotification.js` (Mongoose, targeted the now-
 * removed Mongo store and never populated Postgres). NotificationType + its tag
 * links drive the Email Templates / notification settings screens — the email-
 * template create form selects a NotificationType and offers its tags as
 * merge-fields. Without these the screens have nothing to configure.
 *
 * Tag links use the `NotificationTypeTag` join table. EmailTemplate rows are
 * user-created, so none are seeded. Idempotent (types by unique slug, tags by
 * title, join by composite unique).
 *
 * Run: `npx ts-node prisma/seedNotifications.ts` (or via the install/seed flow).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TAGS: string[] = [
  // Shared
  'Customer Name', 'Supplier Name', 'Company Name',
  // Quotation
  'Quotation Number', 'Quotation Date', 'Expiry Date', 'Quotation Amount', 'View Quotation Link',
  // Invoice
  'Invoice Number', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Invoice Status',
  'Amount Paid', 'Balance Due', 'View Invoice Link',
  // Purchase
  'Purchase Reference', 'Purchase Date', 'Purchase Amount',
  // Purchase Order
  'PO Number', 'PO Date', 'PO Due Date', 'PO Amount',
];

interface TypeDef { title: string; slug: string; tags: string[] }
const QUOTATION_TAGS = ['Quotation Number', 'Quotation Date', 'Expiry Date', 'Quotation Amount', 'Customer Name', 'Company Name', 'View Quotation Link'];
const PURCHASE_TAGS = ['Purchase Reference', 'Purchase Date', 'Purchase Amount', 'Supplier Name', 'Company Name'];
const PO_TAGS = ['PO Number', 'PO Date', 'PO Due Date', 'PO Amount', 'Supplier Name', 'Company Name'];
const TYPES: TypeDef[] = [
  { title: 'New Quotation Created', slug: 'new-quotation-created', tags: QUOTATION_TAGS },
  { title: 'Quotation Approved', slug: 'quotation-approved', tags: QUOTATION_TAGS },
  { title: 'Invoice Generated', slug: 'invoice-generated', tags: ['Invoice Number', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Invoice Status', 'Balance Due', 'Customer Name', 'Company Name', 'View Invoice Link'] },
  { title: 'Invoice Payment Received', slug: 'invoice-payment-received', tags: ['Invoice Number', 'Invoice Date', 'Invoice Amount', 'Amount Paid', 'Balance Due', 'Invoice Status', 'Customer Name', 'Company Name'] },
  { title: 'Purchase Added', slug: 'purchase-added', tags: PURCHASE_TAGS },
  { title: 'Purchase Updated', slug: 'purchase-updated', tags: PURCHASE_TAGS },
  { title: 'Purchase Order Created', slug: 'purchase-order-created', tags: PO_TAGS },
  { title: 'Purchase Order Approved', slug: 'purchase-order-approved', tags: PO_TAGS },
];

export async function seedNotifications(): Promise<{ tags: number; types: number; links: number }> {
  let tagCount = 0;
  let typeCount = 0;
  let linkCount = 0;

  // 1. Tags (idempotent by title — title is not unique in the schema, so guard on findFirst).
  const tagIdByTitle = new Map<string, string>();
  for (const title of TAGS) {
    let tag = await prisma.notificationTag.findFirst({ where: { title } });
    if (!tag) {
      tag = await prisma.notificationTag.create({ data: { title } });
      tagCount += 1;
    }
    tagIdByTitle.set(title, tag.id);
  }

  // 2. Types + tag links.
  for (const t of TYPES) {
    let type = await prisma.notificationType.findUnique({ where: { slug: t.slug } });
    if (!type) {
      type = await prisma.notificationType.create({ data: { title: t.title, slug: t.slug } });
      typeCount += 1;
    }
    for (const tagTitle of t.tags) {
      const tagId = tagIdByTitle.get(tagTitle);
      if (!tagId) continue;
      const existing = await prisma.notificationTypeTag.findFirst({
        where: { notificationTypeId: type.id, notificationTagId: tagId },
      });
      if (!existing) {
        await prisma.notificationTypeTag.create({
          data: { notificationTypeId: type.id, notificationTagId: tagId },
        });
        linkCount += 1;
      }
    }
  }

  return { tags: tagCount, types: typeCount, links: linkCount };
}

if (require.main === module) {
  seedNotifications()
    .then((r) => { console.log(`Notifications seeded (created ${r.types} types, ${r.tags} tags, ${r.links} links).`); return prisma.$disconnect(); })
    .then(() => process.exit(0))
    .catch(async (e) => { console.error('seedNotifications error:', e); await prisma.$disconnect(); process.exit(1); });
}
