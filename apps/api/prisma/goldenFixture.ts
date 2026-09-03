/**
 * Deterministic fixture behind the Products golden-response check.
 *
 * The refactor of ProductController into controller/service/repository has to
 * be behaviour-preserving, and the only convincing evidence of that is the
 * bytes on the wire before and after. This builds a database the product
 * endpoints can be driven against, and prints a token for driving them.
 *
 * DETERMINISTIC ON PURPOSE: every id is a fixed string and every timestamp is
 * pinned, because the captured JSON is diffed byte-for-byte. A uuid default or
 * a `new Date()` would make every run differ from the last and the diff
 * worthless.
 *
 * Idempotent: it clears its own tenant first, so it can be re-run between the
 * before and after captures.
 *
 * Run:  npx ts-node prisma/goldenFixture.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

import { seedRolesForTenant } from './seedRoles';
import { generateToken } from '../utils/generateToken';

const prisma = new PrismaClient();

const T = 'golden-tenant-0000-0000-000000000001';
const U = 'golden-user-0000-0000-0000000000001';
const AT = new Date('2026-01-01T00:00:00.000Z');

/**
 * A distinct timestamp per product.
 *
 * getAllProducts orders by `createdAt: 'desc'`. Rows sharing a timestamp are a
 * tie, and Postgres is free to return a tie in any order — so seeding every
 * product with the same instant made the captured list order vary between runs
 * and the byte-for-byte diff meaningless. Each product gets its own second.
 */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

const D = (n: number | string) => new Prisma.Decimal(n);

async function wipe(): Promise<void> {
  // Children first; the fixture owns every row it touches.
  await prisma.customFieldValue.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.inventory.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.product.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.taxRate.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.taxGroup.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.category.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.brand.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.unit.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.permission.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.tenantMembership.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.role.deleteMany({ where: { tenantId: T } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: U } }).catch(() => {});
  await prisma.tenant.deleteMany({ where: { id: T } }).catch(() => {});
}

async function main(): Promise<void> {
  await wipe();

  await prisma.tenant.create({
    data: { id: T, name: 'Golden Co', slug: 'golden-co', status: 'ACTIVE', createdAt: AT, updatedAt: AT },
  });
  await prisma.user.create({
    data: {
      id: U,
      firstName: 'Golden',
      lastName: 'Owner',
      email: 'owner@golden.test',
      password: 'x',
      createdAt: AT, updatedAt: AT,
    },
  });

  // The module catalogue must exist before roles are seeded: seedRolesForTenant
  // writes one Permission row per Module, so seeding roles against an empty
  // Module table produces an Owner with no permissions and every request 403s.
  const { seedModules } = await import('./seedModules');
  await seedModules();

  // Roles + permissions then come from the real seeder, so the fixture's Owner
  // has exactly the permissions a real Owner has — including the allowAll row
  // requirePermission checks.
  const { roleIds } = await seedRolesForTenant(T, prisma);
  const ownerRoleId = await prisma.role
    .findFirst({ where: { tenantId: T, roleName: { equals: 'Owner', mode: 'insensitive' } } })
    .then((r) => r?.id ?? Object.values(roleIds)[0]);

  const membership = await prisma.tenantMembership.create({
    data: {
      id: 'golden-membership-000000000001',
      tenantId: T,
      userId: U,
      roleId: ownerRoleId,
      isOwner: true,
      status: 'ACTIVE',
      createdAt: AT, updatedAt: AT,
    },
  });

  // Reference data the product includes reach into.
  const unit = await prisma.unit.create({
    data: { id: 'golden-unit-000000000000001', tenantId: T, unit_name: 'Pieces', short_name: 'pcs', createdAt: AT, updatedAt: AT },
  });
  const category = await prisma.category.create({
    data: { id: 'golden-cat-0000000000000001', tenantId: T, category_name: 'Hardware', slug: 'hardware', createdAt: AT, updatedAt: AT },
  });
  const brand = await prisma.brand.create({
    data: { id: 'golden-brand-00000000000001', tenantId: T, brand_name: 'Acme', createdAt: AT, updatedAt: AT },
  });
  await prisma.taxRate.createMany({
    data: [
      { id: 'golden-rate-cgst-000000000001', tenantId: T, name: 'CGST 9%', rate: D(9), regime: 'GST_INDIA', isActive: true, createdAt: AT, updatedAt: AT },
      { id: 'golden-rate-sgst-000000000001', tenantId: T, name: 'SGST 9%', rate: D(9), regime: 'GST_INDIA', isActive: true, createdAt: AT, updatedAt: AT },
    ],
  });
  // TaxGroup <-> TaxRate is many-to-many (tax_rates / tax_groups), so the group
  // owns the connection rather than each rate carrying a foreign key.
  const group = await prisma.taxGroup.create({
    data: {
      id: 'golden-taxgroup-000000000001',
      tenantId: T,
      tax_name: 'GST 18%',
      createdAt: AT,
      updatedAt: AT,
      tax_rates: {
        connect: [{ id: 'golden-rate-cgst-000000000001' }, { id: 'golden-rate-sgst-000000000001' }],
      },
    },
  });

  // Products spanning the branches the response formatter has: with and without
  // a category/brand/unit, tracked and untracked inventory, a status:false row,
  // and enough rows to make pagination meaningful.
  //
  // Note there is no soft-delete to model: Product has no isDeleted column and
  // deleteProduct does a real DELETE inside a transaction that clears Inventory
  // first — unusual for this codebase, and worth preserving deliberately.
  const base = {
    tenantId: T,
    unitId: unit.id,
    categoryId: category.id,
    brandId: brand.id,
    taxGroupId: group.id,
    updatedAt: AT,
  };

  await prisma.product.create({
    data: {
      ...base,
      id: 'golden-product-0000000000001',
      createdAt: at(1),
      name: 'Widget',
      code: 'PROD-GOLDEN01',
      description: 'A widget',
      barcode: '111',
      selling_price: D('19.99'),
      purchase_price: D('10.00'),
      item_type: 'Product',
      stock: 5,
      alert_quantity: 2,
    },
  });
  await prisma.product.create({
    data: {
      ...base,
      id: 'golden-product-0000000000002',
      createdAt: at(2),
      categoryId: null,
      brandId: null,
      taxGroupId: null,
      name: 'Consulting',
      code: 'PROD-GOLDEN02',
      description: 'An hour of advice',
      selling_price: D('100.00'),
      purchase_price: D('0.00'),
      item_type: 'Service',
      stock: 0,
    },
  });
  await prisma.product.create({
    data: {
      ...base,
      id: 'golden-product-0000000000003',
      createdAt: at(3),
      name: 'Inactive Widget',
      code: 'PROD-GOLDEN03',
      selling_price: D('1.00'),
      purchase_price: D('1.00'),
      item_type: 'Product',
      status: false,
    },
  });
  for (let i = 4; i <= 14; i += 1) {
    await prisma.product.create({
      data: {
        ...base,
        id: `golden-product-000000000${String(i).padStart(4, '0')}`,
        createdAt: at(i),
        name: `Bulk item ${String(i).padStart(2, '0')}`,
        code: `PROD-GOLDEN${String(i).padStart(2, '0')}`,
        selling_price: D(i),
        purchase_price: D(i),
        item_type: 'Product',
        stock: i,
      },
    });
  }

  // A live Inventory row, so the batch merge in getAllProducts has something to
  // override `stock` with.
  await prisma.inventory.create({
    data: {
      id: 'golden-inventory-00000000001',
      tenantId: T,
      productId: 'golden-product-0000000000001',
      quantity: 42,
      createdAt: AT, updatedAt: AT,
    },
  });

  const token = generateToken(U, T, membership.id);
  console.log(JSON.stringify({ tenantId: T, userId: U, token }, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('fixture failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
