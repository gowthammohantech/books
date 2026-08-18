import { PrismaClient } from '@prisma/client';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';
const prisma = new PrismaClient();

// [table, newCol, oldCol, legacyStampCol]
const CUSTOMER_SIDE: [string, string, string][] = [
  ['Invoice', 'contactId', 'customerId'],
  ['Invoice', 'billToContactId', 'billTo'],
  ['Quotation', 'contactId', 'customerId'],
  ['Quotation', 'billToContactId', 'billTo'],
  ['CreditNote', 'contactId', 'customerId'],
  ['CreditNote', 'billToContactId', 'billTo'],
  ['DeliveryChallan', 'contactId', 'customerId'],
  ['DeliveryChallan', 'billToContactId', 'billTo'],
  ['Reminder', 'targetContactId', 'targetCustomer'],
  ['Vehicle', 'contactId', 'customerId'],
];
const SUPPLIER_SIDE: [string, string, string][] = [
  ['Purchase', 'contactId', 'supplierId'],
  ['PurchaseOrder', 'contactId', 'supplierId'],
  ['SupplierPayment', 'contactId', 'supplierId'],
  ['DebitNote', 'contactId', 'supplierId'],
  ['DebitNote', 'billToContactId', 'billToSupplierId'],
  ['Expense', 'contactId', 'supplierId'],
];

async function repoint(table: string, newCol: string, oldCol: string, stamp: 'legacyCustomerId' | 'legacySupplierId'): Promise<number> {
  // Set newCol from the Contact whose stamp == oldCol
  const res = await prisma.$executeRawUnsafe(
    `UPDATE "${table}" t SET "${newCol}" = c.id
     FROM "Contact" c
     WHERE c."${stamp}" = t."${oldCol}" AND t."${oldCol}" IS NOT NULL AND t."${newCol}" IS NULL`,
  );
  return res;
}

async function orphanCount(table: string, newCol: string, oldCol: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM "${table}" WHERE "${oldCol}" IS NOT NULL AND "${newCol}" IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function backfillContactFks(): Promise<void> {
  let orphans = 0;
  for (const [t, nc, oc] of CUSTOMER_SIDE) {
    const n = await repoint(t, nc, oc, 'legacyCustomerId');
    const o = await orphanCount(t, nc, oc);
    orphans += o;
    console.log(`[OK] ${t}.${nc}: ${n} repointed${o ? `  [ORPHAN] ${o} left null` : ''}`);
  }
  for (const [t, nc, oc] of SUPPLIER_SIDE) {
    const n = await repoint(t, nc, oc, 'legacySupplierId');
    const o = await orphanCount(t, nc, oc);
    orphans += o;
    console.log(`[OK] ${t}.${nc}: ${n} repointed${o ? `  [ORPHAN] ${o} left null` : ''}`);
  }
  // Vendor safety: any Purchase/PO/DebitNote still lacking a contactId but carrying a
  // legacy vendorId(User) gets a Contact synthesized from that user, then repointed.
  // The vendorId column was dropped by the drop_vendor_user migration on installs that
  // already ran the legacy vendor flow to completion, so guard on its existence first.
  const VENDOR_TABLES = ['Purchase', 'PurchaseOrder', 'DebitNote'];
  for (const t of VENDOR_TABLES) {
    const hasVendorId = await columnExists(t, 'vendorId');
    if (!hasVendorId) {
      console.log(`[backfill] vendorId column absent (dropped) — skipping vendor pass for ${t}`);
      continue;
    }
    const rows = await prisma.$queryRawUnsafe<{ id: string; vendorId: string; userId: string }[]>(
      `SELECT t.id, t."vendorId", t."userId" FROM "${t}" t WHERE t."vendorId" IS NOT NULL AND t."contactId" IS NULL`,
    );
    for (const r of rows) {
      const u = await prisma.user.findUnique({ where: { id: r.vendorId }, select: { firstName: true, lastName: true, email: true } });
      const organisation = resolveDisplayName({ firstName: u?.firstName, lastName: u?.lastName }) || (u?.email ?? 'Legacy vendor');
      const contact = await (prisma as unknown as Record<string, any>).contact.create({ data: { userId: r.userId, organisation, email: u?.email ?? null } as never });
      await prisma.$executeRawUnsafe(`UPDATE "${t}" SET "contactId" = $1 WHERE id = $2`, contact.id, r.id);
      console.log(`[VENDOR->CONTACT] ${t} ${r.id}: created contact ${contact.id} from user ${r.vendorId}`);
    }
  }

  if (orphans > 0) {
    console.error(`\nFAIL: ${orphans} rows had a legacy id but no contactId — investigate before dropping legacy columns.`);
    process.exitCode = 1;
  } else {
    console.log(`\nBackfill complete: every legacy-referenced row now has a contactId.`);
  }
}

// Only run when invoked directly (e.g. `ts-node prisma/backfillContactFks.ts`),
// not when imported by the boot bootstrap or a test spec.
if (require.main === module) {
  backfillContactFks().then(() => prisma.$disconnect()).then(() => process.exit(process.exitCode ?? 0))
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
