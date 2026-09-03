import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

// Both files are mounted at /api/admin (server.ts): adminRoutes.ts is the bulk,
// dimensionRoutes.ts adds cost-centers/projects/dimension P&L reports. Every
// admin route in either file must carry requirePermission(...) OR an explicit
// /* self */ exemption marker (self/identity routes intentionally gated by
// `protect` alone).
const files = ['routes/adminRoutes.ts', 'routes/dimensionRoutes.ts'];

// Each router.<verb>('path', ...) statement must contain requirePermission( OR a /* self */ marker.
const routeLine = /router\.(get|post|put|patch|delete)\(/i;

describe('admin route authorization coverage', () => {
  for (const rel of files) {
    it(`every admin route in ${rel} has requirePermission or an explicit self-exemption`, () => {
      const file = path.join(__dirname, '..', rel);
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const offenders: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        // Skip commented-out route declarations (e.g. `// router.get(...)`).
        if (/^\s*(\/\/|\*)/.test(lines[i])) continue;
        if (!routeLine.test(lines[i])) continue;
        // Gather the full statement (until the line ending in `);`).
        let stmt = lines[i];
        let j = i;
        while (!/\);\s*$/.test(stmt) && j < lines.length - 1) { j++; stmt += '\n' + lines[j]; }
        if (!/requirePermission\(/.test(stmt) && !/\/\*\s*self\s*\*\//.test(stmt)) {
          offenders.push(lines[i].trim());
        }
      }
      expect(offenders, `Ungated admin routes in ${rel}:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});


// ---------------------------------------------------------------------------
// Tenant-scope coverage
// ---------------------------------------------------------------------------
//
// Authorization ("may this role do this?") and isolation ("whose data is it?")
// are different questions, and the block above only asks the first. A route can
// be perfectly permissioned and still read every workspace's rows — which is
// exactly what P4's sweep found in 56 places.
//
// lib/tenantGuard.ts is the structural answer, but it has documented holes
// (raw SQL, relation reads, `connect`) and ships in `warn` mode, so it is
// defence in depth rather than the only line. This check keeps the FIRST line
// honest: every routed controller either scopes itself, or says out loud that
// it does not need to.
//
// A controller qualifies by importing requireTenantId / tenantScope /
// requireActingUserId, or by carrying a `@cross-tenant` marker explaining why
// it legitimately spans workspaces (auth, public token links, webhooks,
// platform version info).

/** Controllers referenced by a route file, resolved to a path on disk. */
function routedControllerFiles(routeFile: string): string[] {
  const src = fs.readFileSync(path.join(__dirname, '..', routeFile), 'utf8');
  const found = new Set<string>();

  // `require('../controllers/x')`, `require('@controllers/x')`, and
  // `import ... from '../controllers/x'` all appear in these files.
  const re = /(?:require\(|from\s+)['"]((?:\.\.\/|@)controllers\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const rel = m[1].replace(/^@controllers\//, '../controllers/');
    for (const ext of ['.ts', '.js']) {
      const abs = path.join(__dirname, '..', 'routes', rel + ext);
      if (fs.existsSync(abs)) { found.add(abs); break; }
    }
  }
  return [...found];
}

const SCOPING = /requireTenantId|tenantScope|requireActingUserId/;
const CROSS_TENANT = /@cross-tenant/;

describe('routed controllers are tenant-scoped', () => {
  for (const rel of [...files, 'routes/authRoutes.ts', 'routes/exportRoutes.ts',
                     'routes/timeTrackingRoutes.ts', 'routes/mtdRoutes.ts',
                     'routes/taxReturnRoutes.ts', 'routes/reminderRoutes.ts']) {
    it(`every controller behind ${rel} scopes by tenant or declares why not`, () => {
      const controllers = routedControllerFiles(rel);
      // A route file that resolves no controllers means the regex has drifted,
      // which would make this test pass by looking at nothing.
      expect(controllers.length, `no controllers resolved from ${rel}`).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const abs of controllers) {
        const src = fs.readFileSync(abs, 'utf8');
        if (SCOPING.test(src) || CROSS_TENANT.test(src)) continue;
        offenders.push(path.relative(path.join(__dirname, '..'), abs));
      }

      expect(
        offenders,
        `These controllers neither scope by tenant nor carry a /* @cross-tenant: reason */ marker:\n` +
          offenders.join('\n'),
      ).toEqual([]);
    });
  }
});


// ---------------------------------------------------------------------------
// Per-handler tenant scoping
// ---------------------------------------------------------------------------
//
// The block above is FILE-granular, and that is exactly how the Bill From leak
// survived it: `purchaseOrderController.ts` imports requireTenantId,
// tenantScope AND requireActingUserId on line 13 for its other handlers, so the
// file passed while `listUsersByType` returned every user on the installation.
// The bug was handler-granular; the check was not.
//
// So: each exported handler that talks to Prisma must scope itself. The
// baseline below records the handlers that did not when this check was written
// — it is a ratchet, not an amnesty. The test fails on a NEW unscoped handler,
// and it also fails on a baseline entry that has since been fixed, so the list
// can only ever shrink.

/** Every `export [async] function name(...) { ... }` with its body. */
function exportedHandlers(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Walk past the parameter list (it can contain nested parens/generics).
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    const open = src.indexOf('{', i);
    if (open < 0) continue;
    depth = 0;
    let k = open;
    for (; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
    }
    out.push({ name: m[1], body: src.slice(open, k) });
  }
  return out;
}

const HANDLER_SCOPING =
  /requireTenantId|tenantScope\(|requireActingUserId|tenantMemberWhere|activeTenantMemberWhere|isTenantMember|listTenantMemberIds|assertBillFromMember/;

/**
 * Handlers that do not scope themselves, as of the cross-tenant audit.
 *
 * Most are benign (global geo/lookup tables, or a handler that delegates to a
 * scoped helper) but they have not been individually verified, and this list
 * exists so that fact is visible rather than implied. Delete an entry when you
 * scope its handler — the test will tell you if you forget.
 */
const UNSCOPED_HANDLER_BASELINE = new Set<string>([
  'controllers/Admin/Invoice/deliveryChallanController.ts::updateDeliveryStatus',
  'controllers/Admin/Invoice/deliveryChallanController.ts::getDeliveryChallans',
  'controllers/Admin/Invoice/deliveryChallanController.ts::getDeliveryChallanById',
  'controllers/Admin/Invoice/deliveryChallanController.ts::deleteDeliveryChallan',
  'controllers/Admin/Invoice/invoiceController.ts::listInvoicesMinimal',
  'controllers/Admin/Invoice/invoiceController.ts::listInvoicesMinimalWithoutChallan',
  'controllers/Admin/Invoice/quotationController.ts::getQuotationById',
  'controllers/Admin/Invoice/quotationController.ts::deleteQuotation',
  'controllers/Admin/Invoice/quotationController.ts::getAllCustomers',
  'controllers/Admin/Invoice/quotationController.ts::updateQuotationStatus',
  'controllers/Admin/Invoice/quotationController.ts::sendQuotationEmailAndUpdateStatus',
  'controllers/Admin/Purchases/SupplierController.ts::listSuppliers',
  'controllers/Admin/Purchases/SupplierController.ts::updateSupplier',
  'controllers/Admin/Purchases/SupplierController.ts::getSupplierById',
  'controllers/Admin/Purchases/SupplierController.ts::deleteSupplier',
  'controllers/Admin/Purchases/purchaseOrderController.ts::listBankDetails',
  'controllers/Admin/Purchases/purchaseOrderController.ts::listPurchaseOrdersMinimal',
  'controllers/SignatureController.ts::createPaymentMode',
  'controllers/SignatureController.ts::listPaymentModes',
  'controllers/adminController.ts::getCountries',
  'controllers/adminController.ts::getStates',
  'controllers/adminController.ts::getCities',
  'controllers/adminController.ts::getCountryById',
  'controllers/adminController.ts::getStateById',
  'controllers/adminController.ts::getCityById',
  'controllers/emailTeamplateController.ts::listNotificationTypes',
  'controllers/fieldTypeController.ts::createFieldType',
  'controllers/fieldTypeController.ts::getFieldTypes',
  'controllers/localizationController.ts::saveLocalization',
  'controllers/localizationController.ts::getLocalization',
  'controllers/permissionController.ts::getPermissionsByRole',
  'controllers/permissionController.ts::getModuleHierarchy',
  'controllers/recurringScheduleController.ts::pauseSchedule',
  'controllers/recurringScheduleController.ts::resumeSchedule',
  'controllers/recurringScheduleController.ts::endSchedule',
  'controllers/roleController.ts::getRoles',
  'controllers/roleController.ts::getAllRoles',
  'controllers/roleController.ts::updateRole',
  'controllers/roleController.ts::deleteRole',
  'controllers/securityController.ts::resetPassword',
  'controllers/securityController.ts::deleteAccount',
  'controllers/securityController.ts::getLoginActivitiesByUser',
  'controllers/taxReturnController.ts::loadEcSalesList',
  'controllers/taxReturnController.ts::loadOssReturn',
]);

const ROUTE_FILES_FOR_HANDLER_CHECK = [
  ...files,
  'routes/authRoutes.ts',
  'routes/exportRoutes.ts',
  'routes/timeTrackingRoutes.ts',
  'routes/mtdRoutes.ts',
  'routes/taxReturnRoutes.ts',
  'routes/reminderRoutes.ts',
];

describe('routed handlers are individually tenant-scoped', () => {
  it('no NEW handler queries Prisma without scoping itself', () => {
    const controllers = new Set<string>();
    for (const rel of ROUTE_FILES_FOR_HANDLER_CHECK) {
      for (const abs of routedControllerFiles(rel)) controllers.add(abs);
    }
    expect(controllers.size, 'no controllers resolved').toBeGreaterThan(0);

    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const abs of [...controllers].sort()) {
      const src = fs.readFileSync(abs, 'utf8');
      if (CROSS_TENANT.test(src)) continue;
      const rel = path.relative(path.join(__dirname, '..'), abs).split(path.sep).join('/');
      for (const h of exportedHandlers(src)) {
        if (!/prisma\./.test(h.body)) continue;
        if (HANDLER_SCOPING.test(h.body)) continue;
        const key = `${rel}::${h.name}`;
        seen.add(key);
        if (!UNSCOPED_HANDLER_BASELINE.has(key)) offenders.push(key);
      }
    }

    expect(
      offenders,
      'These handlers query Prisma without any tenant scoping of their own.\n' +
        'Scope them (requireTenantId / tenantScope / a lib/tenantMembers helper),\n' +
        'or mark the whole controller /* @cross-tenant: reason */:\n' +
        offenders.join('\n'),
    ).toEqual([]);

    const stale = [...UNSCOPED_HANDLER_BASELINE].filter((k) => !seen.has(k));
    expect(
      stale,
      'These baseline entries are now scoped (or gone). Delete them from\n' +
        'UNSCOPED_HANDLER_BASELINE — the list is a ratchet and may only shrink:\n' +
        stale.join('\n'),
    ).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// `User` queries carry a membership predicate
// ---------------------------------------------------------------------------
//
// `User` is on the tenant guard's EXPLICIT_MODELS list — a person belongs to N
// workspaces, so there is no `User.tenantId` to filter on, and the guard cannot
// help. lib/tenantMembers.ts is the by-hand answer; this check is what makes
// using it non-optional.
//
// Every `prisma.user.find*` outside the sanctioned files must, somewhere in an
// enclosing block, either reference a membership helper / predicate or carry an
// explicit `@user-scope:` marker saying why it is not membership-filtered (a
// self-account read, or a deliberately global email-uniqueness check).

const USER_QUERY_EXEMPT_FILES = new Set([
  // The helpers themselves.
  'lib/tenantMembers.ts',
  // Both are marked @cross-tenant: sign-in and public token links resolve a
  // person BEFORE any workspace is known.
  'controllers/authController.ts',
  'controllers/externalController.ts',
]);

const USER_QUERY_OK =
  /tenantMemberWhere|activeTenantMemberWhere|isTenantMember|listTenantMemberIds|assertBillFromMember|tenantOwnerUserId|membershipIn\(|tenantMembership\.|memberships:\s*\{|@user-scope:/;

/** Source directories a routed request can reach. */
const USER_QUERY_DIRS = ['controllers', 'lib', 'middleware', 'services', 'validators', 'utils', 'routes'];

function walkTs(dir: string, out: string[] = []): string[] {
  const abs = path.join(__dirname, '..', dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(rel, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(rel);
  }
  return out;
}

/**
 * The blocks enclosing `index`, outermost-last, each extended upwards over any
 * immediately preceding comment lines (so a marker written above the statement
 * counts).
 */
function enclosingBlocks(src: string, index: number, levels = 4): string[] {
  const blocks: string[] = [];
  let start = index;
  for (let l = 0; l < levels; l++) {
    let depth = 0;
    let i = start - 1;
    for (; i >= 0; i--) {
      const c = src[i];
      if (c === '}') depth++;
      else if (c === '{') { if (depth === 0) break; depth--; }
    }
    if (i < 0) break;
    let d = 0;
    let j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) { j++; break; } }
    }
    let k = src.lastIndexOf('\n', i);
    for (let back = 0; back < 12; back++) {
      const prev = src.lastIndexOf('\n', k - 1);
      if (prev < 0) break;
      if (!/^\s*(\/\/|\*|\/\*)/.test(src.slice(prev + 1, k))) break;
      k = prev;
    }
    blocks.push(src.slice(k, j));
    start = i;
  }
  return blocks;
}

describe('User queries are membership-scoped', () => {
  it('every prisma.user.find* names a membership predicate or says why not', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const dir of USER_QUERY_DIRS) {
      for (const rel of walkTs(dir)) {
        const key = rel.split(path.sep).join('/');
        if (USER_QUERY_EXEMPT_FILES.has(key)) continue;
        const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        const re = /prisma\.user\.find\w*/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          checked++;
          if (enclosingBlocks(src, m.index).some((b) => USER_QUERY_OK.test(b))) continue;
          offenders.push(`${key}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }

    // A zero here would mean the scan found nothing and passed vacuously.
    expect(checked, 'no prisma.user.find* calls were scanned').toBeGreaterThan(0);
    expect(
      offenders,
      'These User queries carry no membership predicate. `User` is the one model\n' +
        'the tenant guard cannot scope, so this must be done by hand — use a\n' +
        'lib/tenantMembers helper, or add an `@user-scope: <why>` comment if the\n' +
        'query is legitimately not workspace-filtered (self reads, email uniqueness):\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
