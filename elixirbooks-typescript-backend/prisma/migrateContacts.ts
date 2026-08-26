import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateForOwner(userId: string): Promise<{ created: number; merged: number; nearMisses: number }> {
  const customers = await prisma.customer.findMany({ where: { userId, isDeleted: false } });
  const suppliers = await prisma.supplier.findMany({ where: { user_id: userId, isDeleted: false } });
  const plan = planMerges(
    customers.map((c) => ({ id: c.id, email: c.email, name: c.name })),
    suppliers.map((s) => ({ id: s.id, email: s.supplier_email, name: s.supplier_name })),
  );
  const mergedSupplierIds = new Set(plan.merges.map((m) => m.supplierId));

  const contactDelegate = (prisma as unknown as Record<string, any>).contact;
  let created = 0;

  // 1) suppliers first (skip those that will merge into a customer)
  for (const s of suppliers) {
    if (mergedSupplierIds.has(s.id)) continue;
    const existing = await contactDelegate.findFirst({ where: { legacySupplierId: s.id } });
    if (existing) continue;
    await contactDelegate.create({
      data: {
        userId,
        legacySupplierId: s.id,
        organisation: s.supplier_name,
        email: s.supplier_email,
        telephone: s.supplier_phone,
        currencyCode: s.currencyCode ?? null,
        countryId: s.countryId ?? null,
        region: s.stateId ?? null,
        image: s.profileImage ?? null,
        status: s.status ? 'ACTIVE' : 'HIDDEN',
      },
    });
    created += 1;
  }

  // 2) customers (merge-aware: if this customer has a merge partner, attach legacySupplierId too)
  for (const c of customers) {
    const existing = await contactDelegate.findFirst({ where: { legacyCustomerId: c.id } });
    if (existing) continue;
    const mergeSupplierId = plan.merges.find((m) => m.customerId === c.id)?.supplierId ?? null;
    const addr = (c.billingAddress as Record<string, unknown> | null) ?? {};
    await contactDelegate.create({
      data: {
        userId,
        legacyCustomerId: c.id,
        legacySupplierId: mergeSupplierId,
        organisation: c.name,
        email: c.email,
        telephone: c.phone ?? null,
        mobile: c.whatsapp ?? null,
        addressLine1: (addr['addressLine1'] as string) ?? null,
        addressLine2: (addr['addressLine2'] as string) ?? null,
        town: (addr['city'] as string) ?? null,
        region: (addr['state'] as string) ?? null,
        postcode: (addr['pincode'] as string) ?? null,
        gstin: c.gstin ?? null,
        currencyCode: c.currencyCode ?? null,
        notes: c.notes ?? null,
        image: c.image ?? null,
        bankDetails: (c.bankDetails as never) ?? null,
        status: c.status === 'Active' ? 'ACTIVE' : 'HIDDEN',
      },
    });
    created += 1;
  }

  for (const m of plan.merges) console.log(`[MERGE] owner=${userId} customer=${m.customerId} + supplier=${m.supplierId}`);
  for (const n of plan.nearMisses) console.log(`[NEAR-MISS] owner=${userId} org="${n.organisation}" customer=${n.customerId} supplier=${n.supplierId} — review for manual merge`);
  return { created, merged: plan.merges.length, nearMisses: plan.nearMisses.length };
}

export async function migrateContacts(): Promise<void> {
  const owners = await prisma.user.findMany({ where: { ownerId: null }, select: { id: true, email: true } });
  let created = 0, merged = 0, near = 0;
  for (const o of owners) {
    const r = await migrateForOwner(o.id);
    console.log(`[OK] ${o.email}: created ${r.created}, merged ${r.merged}, near-miss ${r.nearMisses}`);
    created += r.created; merged += r.merged; near += r.nearMisses;
  }
  console.log(`\nContacts migration complete: ${created} contacts created, ${merged} merges, ${near} near-misses across ${owners.length} owners.`);
}

// Only run main when invoked directly (not when imported by the spec)
if (require.main === module) {
  migrateContacts().then(() => prisma.$disconnect()).then(() => process.exit(0))
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}

export function normalizeEmail(e?: string | null): string {
  return (e ?? '').trim().toLowerCase();
}
export function normalizeOrg(name?: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface PartyRow { id: string; email: string; name: string }
export interface MergePlan {
  merges: { customerId: string; supplierId: string }[];
  nearMisses: { customerId: string; supplierId: string; organisation: string }[];
}

/** Merge a customer + supplier into one contact on EXACT normalized email.
 *  Same normalized org but different (or empty) email -> near-miss for manual review. */
export function planMerges(customers: PartyRow[], suppliers: PartyRow[]): MergePlan {
  const merges: MergePlan['merges'] = [];
  const nearMisses: MergePlan['nearMisses'] = [];
  const supByEmail = new Map<string, PartyRow>();
  const supByOrg = new Map<string, PartyRow[]>();
  for (const s of suppliers) {
    const e = normalizeEmail(s.email);
    if (e) supByEmail.set(e, s);
    const o = normalizeOrg(s.name);
    if (o) { const arr = supByOrg.get(o) ?? []; arr.push(s); supByOrg.set(o, arr); }
  }
  const mergedSupplierIds = new Set<string>();
  for (const c of customers) {
    const e = normalizeEmail(c.email);
    if (e && supByEmail.has(e)) {
      const s = supByEmail.get(e)!;
      merges.push({ customerId: c.id, supplierId: s.id });
      mergedSupplierIds.add(s.id);
    }
  }
  // near-misses: same normalized org, not already email-merged
  for (const c of customers) {
    const o = normalizeOrg(c.name);
    const sups = (o && supByOrg.get(o)) || [];
    for (const s of sups) {
      if (mergedSupplierIds.has(s.id)) continue;
      if (normalizeEmail(c.email) && normalizeEmail(c.email) === normalizeEmail(s.email)) continue;
      nearMisses.push({ customerId: c.id, supplierId: s.id, organisation: c.name });
    }
  }
  return { merges, nearMisses };
}
