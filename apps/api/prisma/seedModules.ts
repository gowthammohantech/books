/**
 * Postgres/Prisma module-hierarchy seed.
 *
 * Replaces the legacy MongoDB `seedModules.js` (which targeted a now-removed
 * Mongo store and therefore never populated the Postgres `Module` table). The
 * module hierarchy drives the role/permission tree AND the per-module custom-
 * fields screens (Settings → Module Settings). Idempotent: existing modules
 * (matched by moduleSlug) are left untouched, missing ones are created.
 *
 * Run: `npx ts-node prisma/seedModules.ts`  (or via the install/seed flow).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ChildDef { moduleName: string; moduleSlug: string }
interface ParentDef { moduleName: string; moduleSlug: string; children: ChildDef[] }

const HIERARCHY: ParentDef[] = [
  { moduleName: 'Main', moduleSlug: 'main', children: [
    { moduleName: 'Dashboard', moduleSlug: 'dashboard' },
  ] },
  { moduleName: 'Inventory & Sales', moduleSlug: 'inventory-sales', children: [
    { moduleName: 'Product / Services', moduleSlug: 'product-services' },
    { moduleName: 'Categories', moduleSlug: 'categories' },
    { moduleName: 'Brands', moduleSlug: 'brands' },
    { moduleName: 'Units', moduleSlug: 'units' },
    { moduleName: 'Inventory', moduleSlug: 'inventory' },
    { moduleName: 'Invoices', moduleSlug: 'invoices' },
    { moduleName: 'Recurring Invoices', moduleSlug: 'recurring-invoices' },
    { moduleName: 'Credit Notes', moduleSlug: 'credit-notes' },
    { moduleName: 'Quotations', moduleSlug: 'quotations' },
    { moduleName: 'Delivery Challans', moduleSlug: 'delivery-challans' },
    // The unified Contacts page (replaces the separate legacy Customers/
    // Suppliers screens, which now both redirect to it) was never given its
    // own permission module — admins had no way to enable/disable it for a
    // role at all. 'customers' is kept (existing roles already granted it),
    // routes/adminRoutes.ts now accepts EITHER for the contacts endpoints.
    { moduleName: 'Contacts', moduleSlug: 'contacts' },
    { moduleName: 'Customers', moduleSlug: 'customers' },
    { moduleName: 'Vehicles', moduleSlug: 'vehicles' },
  ] },
  { moduleName: 'Purchases', moduleSlug: 'purchases', children: [
    { moduleName: 'Purchases', moduleSlug: 'purchase-list' },
    { moduleName: 'Purchase Orders', moduleSlug: 'purchase-orders' },
    { moduleName: 'Debit Notes', moduleSlug: 'debit-notes' },
    { moduleName: 'Suppliers', moduleSlug: 'suppliers' },
    { moduleName: 'Supplier Payments', moduleSlug: 'supplier-payments' },
  ] },
  { moduleName: 'Manage Users', moduleSlug: 'manage-users', children: [
    { moduleName: 'Roles & Permissions', moduleSlug: 'roles-permissions' },
    { moduleName: 'Activity Log', moduleSlug: 'activity-log' },
  ] },
  { moduleName: 'Finance & Accounting', moduleSlug: 'finance-accounting', children: [
    { moduleName: 'Expenses', moduleSlug: 'expenses' },
    { moduleName: 'Recurring Expenses', moduleSlug: 'recurring-expenses' },
    { moduleName: 'Banking', moduleSlug: 'banking' },
    { moduleName: 'Bank Transactions', moduleSlug: 'bank-transactions' },
    { moduleName: 'Transaction', moduleSlug: 'transaction' },
    { moduleName: 'Payment Transactions', moduleSlug: 'payment-transactions' },
    { moduleName: 'Petty Cash', moduleSlug: 'petty-cash' },
    { moduleName: 'My Money', moduleSlug: 'my-money' },
    { moduleName: 'Payroll', moduleSlug: 'payroll' },
    { moduleName: 'Time Tracking', moduleSlug: 'time-tracking' },
    { moduleName: 'Time Tracking (Others)', moduleSlug: 'time-tracking-others' },
  ] },
  { moduleName: 'Accounting', moduleSlug: 'accounting', children: [
    { moduleName: 'Chart of Accounts', moduleSlug: 'chart-of-accounts' },
    { moduleName: 'Journal Entries', moduleSlug: 'journal-entries' },
  ] },
  { moduleName: 'AI', moduleSlug: 'ai', children: [] },
  { moduleName: 'Reports', moduleSlug: 'reports', children: [
    { moduleName: 'Item Reports', moduleSlug: 'item-reports' },
    { moduleName: 'Transaction Reports', moduleSlug: 'transaction-reports' },
    { moduleName: 'Finance Reports', moduleSlug: 'finance-reports' },
    { moduleName: 'Accounting Reports', moduleSlug: 'accounting-reports' },
  ] },
  { moduleName: 'Settings', moduleSlug: 'settings', children: [
    { moduleName: 'General Settings', moduleSlug: 'general-settings' },
    { moduleName: 'Website Settings', moduleSlug: 'website-settings' },
    { moduleName: 'System Settings', moduleSlug: 'system-settings' },
    { moduleName: 'Finance Settings', moduleSlug: 'finance-settings' },
    { moduleName: 'Module Settings', moduleSlug: 'module-settings' },
    { moduleName: 'Other Settings', moduleSlug: 'other-settings' },
  ] },
];

async function ensureModule(moduleName: string, moduleSlug: string, parentId: string | null): Promise<string> {
  const existing = await prisma.module.findFirst({ where: { moduleSlug, parentId } });
  if (existing) return existing.id;
  const created = await prisma.module.create({ data: { moduleName, moduleSlug, parentId } });
  return created.id;
}

export async function seedModules(): Promise<{ created: number }> {
  let created = 0;
  for (const parent of HIERARCHY) {
    const before = await prisma.module.findFirst({ where: { moduleSlug: parent.moduleSlug, parentId: null } });
    const parentId = await ensureModule(parent.moduleName, parent.moduleSlug, null);
    if (!before) created += 1;
    for (const child of parent.children) {
      const childBefore = await prisma.module.findFirst({ where: { moduleSlug: child.moduleSlug, parentId } });
      await ensureModule(child.moduleName, child.moduleSlug, parentId);
      if (!childBefore) created += 1;
    }
  }

  // Self-heal: the 20260529_add_audit_log migration seeds a *parentless*
  // `activity-log` module, and it runs before this seed on fresh installs — so a
  // slug that belongs to a child here ends up duplicated at top level. The 2-level
  // permissions grid renders such a parentless, childless module as an empty card
  // that can never be toggled, and authMiddleware keys its perms map by slug, so
  // the duplicate also makes enforcement non-deterministic. A child slug must never
  // exist at top level — drop any strays (and their now-orphaned permission rows).
  const childSlugs = HIERARCHY.flatMap((p) => p.children.map((c) => c.moduleSlug));
  const strays = await prisma.module.findMany({
    where: { parentId: null, moduleSlug: { in: childSlugs } },
    select: { id: true },
  });
  if (strays.length) {
    const strayIds = strays.map((m) => m.id);
    await prisma.permission.deleteMany({ where: { moduleId: { in: strayIds } } });
    await prisma.module.deleteMany({ where: { id: { in: strayIds } } });
  }

  return { created };
}

if (require.main === module) {
  seedModules()
    .then((r) => { console.log(`Modules seeded (created ${r.created} new).`); return prisma.$disconnect(); })
    .then(() => process.exit(0))
    .catch(async (e) => { console.error('seedModules error:', e); await prisma.$disconnect(); process.exit(1); });
}
