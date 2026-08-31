// lib/tenantGuard.ts
//
// Structural tenant isolation for every Prisma query.
//
// Up to P5, scoping was a CONVENTION: each controller remembered to put
// `tenantId` in its `where`. That convention held about 95% of the time — P4's
// sweep found 56 places where it did not, and every one of them was correct
// code before the column existed. A convention that has to be remembered at
// ~2,000 call sites is not isolation; this file is what makes it structural.
//
// HOW IT IS WIRED. Deliberately NOT as a second `$extends`: lib/auditExtension
// already owns `$allModels.$allOperations`, and stacked query-extension ordering
// is subtle in ways that are easy to get wrong and hard to test. This module is
// a PURE function that the audit extension calls as its first statement, before
// its own auditable-or-not short-circuit, so reads are guarded too. One
// interceptor, one place to reason about.
//
// ---------------------------------------------------------------------------
// KNOWN LIMITATIONS — read these before trusting the guard for something.
// ---------------------------------------------------------------------------
//
// 1. NESTED WRITES ARE ONLY GUARDED ONE LEVEL DEEP.
//    `invoice.create({ data: { payments: { create: [...] } } })` dispatches as a
//    single `Invoice` operation, so Prisma never asks the extension about the
//    InvoicePayment rows. We walk `args.data` one level using the DMMF and
//    stamp `tenantId` into nested create/createMany/connectOrCreate payloads
//    whose target is a tenant model. DEEPER NESTING IS UNSUPPORTED and is
//    caught after the fact by prisma/checkTenantIntegrity.ts.
//
// 2. `include` / `select` RELATION READS ARE NOT FILTERED.
//    Loading an invoice with `include: { payments: true }` returns its payments
//    unfiltered. This is safe IFF a foreign key never crosses tenants — which
//    is an invariant of the data, not something this guard can enforce. The
//    integrity check is what verifies it.
//
// 3. `connect: { id }` CAN ATTACH A FOREIGN-TENANT ROW.
//    Not generically detectable here (the guard would have to read every
//    connected id). Controllers validate ids they accept from request bodies;
//    the integrity check is the backstop.
//
// 4. `$queryRaw` / `$executeRaw` ARE INVISIBLE TO THIS GUARD.
//    They do not go through `$allModels`. ESLint bans them outside prisma/**.
//
// 5. `User` IS NOT AND CANNOT BE GUARDED. A person belongs to N workspaces, so
//    there is no `User.tenantId` to filter on. Every user query is scoped BY
//    HAND through TenantMembership (see controllers/userController.ts). THIS IS
//    THE ONE PLACE THE STRUCTURAL GUARANTEE DOES NOT APPLY.
//
// ---------------------------------------------------------------------------
// TENANT_GUARD_MODE = off | warn | enforce
// ---------------------------------------------------------------------------
//
// `warn` (the default, and how this ships) computes every decision and logs
// what it WOULD have done, while passing the original arguments through
// untouched. That turns "did we miss a query?" from a hope into an observable
// signal, on real traffic, with no risk — and it is an env var, so it is
// instantly reversible in either direction.

import { Prisma } from '@prisma/client';

import { getAuditContext } from './auditContext';
import { TenantContextMissingError } from './tenantContext';

// ---------------------------------------------------------------------------
// Model classification
// ---------------------------------------------------------------------------

/**
 * Models the guard filters and stamps. Everything with a `tenantId` column,
 * minus the two that carry one but are queried across tenants by design.
 */
export const TENANT_MODELS = new Set<string>([
  'Account', 'AccountCreditEntry', 'AccountingIntegration', 'AccountingPeriod',
  'AIChatSession', 'AIConfiguration', 'AIPromptLog', 'AIPromptTemplate',
  'AiChatMessage', 'AiChatSession', 'AiConfig', 'AiExtractionJob', 'AiUsageLog',
  'BankDetail', 'BankTransaction', 'Brand', 'Budget',
  'Category', 'CompanySettings', 'Contact', 'Conversation', 'CostCenter',
  'CreditNote', 'Currency', 'Customer', 'CustomField', 'CustomFieldDataType',
  'CustomFieldValue',
  'DebitNote', 'DeliveryChallan',
  'EInvoiceRecord', 'EmailSettings', 'EmailTemplate', 'ExchangeRate', 'Expense',
  'ExpenseCategory', 'ExpenseChangeLog', 'ExplanationHint',
  'FixedAsset',
  'GatewayConfig', 'GeneralSetting',
  'Holiday',
  'Inventory', 'InventoryCostLayer', 'Invoice', 'InvoicePayment', 'InvoiceTemplate',
  'JournalEntry', 'JournalLine',
  'LeaveAllocation', 'LeaveRequest', 'LeaveRequestDay', 'LeaveType',
  'LedgerAccountMapping', 'Localization',
  'MessagingConfig', 'MtdConfig',
  'PayRun', 'PayRunLine', 'PaymentLinkMethod', 'PaymentTransaction',
  'PayrollProfile', 'Permission', 'PettyCash', 'PettyCashTransaction', 'Product',
  'Project', 'ProjectMember', 'Purchase', 'PurchaseOrder',
  'Quotation',
  'RecurringInvoiceSchedule', 'Refund', 'Reminder', 'Role',
  'Signature', 'Supplier', 'SupplierPayment',
  'TaxGroup', 'TaxRate', 'TenantApiKey', 'TimeEntry', 'Timesheet',
  'TransactionCategory',
  'Unit',
  'Vehicle',
]);

/**
 * Platform reference data: the same rows for every company, and none of them
 * editable by a tenant. Passed straight through.
 */
export const GLOBAL_MODELS = new Set<string>([
  'City', 'Country', 'Counter', 'DateFormat', 'FieldType', 'Module',
  'NotificationTag', 'NotificationType', 'NotificationTypeTag', 'PaymentMode',
  'State', 'Tenant', 'TimeFormat', 'Timezone',
]);

/**
 * Models the guard refuses to scope automatically, each for a specific reason.
 * Callers scope these BY HAND.
 *
 *  User              no tenantId — one person, N workspaces. Scoped through
 *                    TenantMembership. See limitation 5 above.
 *  TenantMembership  the table that ANSWERS "which tenant?", so it cannot
 *                    presuppose one: authMiddleware.protect queries it before
 *                    any tenant is verified.
 *  LoginActivity     an ACTOR record. It is about a person signing in, not
 *                    about a workspace, and has no tenantId.
 *  AuditLog          written by this very extension. Guarding it would make the
 *                    audit trail depend on the context of the thing being
 *                    audited.
 */
export const EXPLICIT_MODELS = new Set<string>([
  'User', 'TenantMembership', 'LoginActivity', 'AuditLog',
]);

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

export type GuardMode = 'off' | 'warn' | 'enforce';

export function guardMode(): GuardMode {
  const raw = (process.env.TENANT_GUARD_MODE ?? 'warn').toLowerCase();
  return raw === 'off' || raw === 'enforce' ? raw : 'warn';
}

// ---------------------------------------------------------------------------
// DMMF-derived lookups, computed once
// ---------------------------------------------------------------------------

/** model → { compoundKeyName → field names } for findUnique-style where inputs. */
const COMPOUND_KEYS = new Map<string, Map<string, string[]>>();
/** model → { relationFieldName → target model } */
const RELATIONS = new Map<string, Map<string, string>>();

for (const m of Prisma.dmmf.datamodel.models) {
  const compounds = new Map<string, string[]>();
  for (const fields of m.primaryKey?.fields ? [m.primaryKey.fields] : []) {
    compounds.set(m.primaryKey?.name ?? fields.join('_'), [...fields]);
  }
  for (const u of m.uniqueIndexes ?? []) {
    compounds.set(u.name || u.fields.join('_'), [...u.fields]);
  }
  for (const fields of m.uniqueFields ?? []) {
    if (fields.length > 1) compounds.set(fields.join('_'), [...fields]);
  }
  if (compounds.size) COMPOUND_KEYS.set(m.name, compounds);

  const rels = new Map<string, string>();
  for (const f of m.fields) {
    if (f.kind === 'object') rels.set(f.name, f.type);
  }
  if (rels.size) RELATIONS.set(m.name, rels);
}

/**
 * Rewrites a findUnique-style compound key into plain scalar filters, so the
 * same `where` can be handed to findFirst.
 *
 * `{ tenantId_key: { tenantId, key } }` → `{ tenantId, key }`. Needed because
 * `findFirst` takes a WhereInput, which has no notion of a compound unique
 * input — without this the audit before-read (and therefore the foreign-row
 * check below) silently fails on every compound-keyed update.
 */
export function flattenCompoundKeys(
  model: string,
  where: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!where) return where;
  const compounds = COMPOUND_KEYS.get(model);
  if (!compounds) return where;
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(where)) {
    const fields = compounds.get(key);
    if (!fields || value === null || typeof value !== 'object') continue;
    out = out ?? { ...where };
    delete out[key];
    Object.assign(out, value as Record<string, unknown>);
  }
  return out ?? where;
}

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

const FILTER_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow',
  'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);
const UNIQUE_READ_OPS = new Set(['findUnique', 'findUniqueOrThrow']);
const SINGLE_WRITE_OPS = new Set(['update', 'delete', 'upsert']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A caller asked for one tenant's data while acting as another. Never silently
 * overridden: an explicit mismatched filter is a bug in the caller, and quietly
 * "fixing" it would hide the bug and return data the caller did not ask for.
 */
export class TenantMismatchError extends Error {
  status = 403;
  constructor(model: string, wanted: unknown, actual: string) {
    super(
      `Tenant mismatch on ${model}: the query names tenant "${String(wanted)}" ` +
      `but this request is acting as "${actual}".`,
    );
    this.name = 'TenantMismatchError';
  }
}

/** Shaped like Prisma's P2025 so existing not-found handling keeps working. */
export class ForeignTenantRowError extends Error {
  code = 'P2025';
  status = 404;
  constructor(model: string) {
    super(`An operation failed because it depends on one or more records that were required but not found. No '${model}' record was found for this tenant.`);
    this.name = 'ForeignTenantRowError';
  }
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export interface GuardContext {
  tenantId: string | null;
  bypass: boolean;
  mode: GuardMode;
}

export interface GuardDecision {
  /** Arguments to actually run. In `warn` mode these are the originals. */
  args: unknown;
  /**
   * True when the result of a findUnique must be discarded if it belongs to
   * another tenant (see the note on UNIQUE_READ_OPS below).
   */
  checkResultTenant?: boolean;
  /** True when the before-row read must be checked against this tenant. */
  checkBeforeTenant?: boolean;
  /** Human-readable description of what the guard changed, for `warn` logging. */
  note?: string;
}

const PASS: GuardDecision = { args: undefined };

export function guardContextFromStore(): GuardContext {
  const ctx = getAuditContext();
  return {
    tenantId: ctx?.tenantId ?? null,
    bypass: ctx?.bypass === true,
    mode: guardMode(),
  };
}

/** Is this model one the guard acts on at all? */
export function isGuarded(model: string | undefined): boolean {
  return !!model && TENANT_MODELS.has(model);
}

function mergeWhere(where: unknown, tenantId: string): Record<string, unknown> {
  // AND, never a top-level spread: a caller's `OR` sitting beside the filter
  // would re-widen the query past this tenant.
  return { AND: [where ?? {}, { tenantId }] };
}

/** Reads a caller-supplied literal tenantId out of a where/data object. */
function suppliedTenantId(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const v = (obj as Record<string, unknown>).tenantId;
  return typeof v === 'string' ? v : undefined;
}

function assertNoMismatch(model: string, obj: unknown, tenantId: string): void {
  const supplied = suppliedTenantId(obj);
  if (supplied !== undefined && supplied !== tenantId) {
    throw new TenantMismatchError(model, supplied, tenantId);
  }
}

/**
 * Stamp `tenantId` into a create payload, plus any nested create one level
 * deep whose target model is tenant-scoped (limitation 1).
 */
function stampCreateData(
  model: string,
  data: unknown,
  tenantId: string,
): unknown {
  if (Array.isArray(data)) return data.map((d) => stampCreateData(model, d, tenantId));
  if (!data || typeof data !== 'object') return data;

  assertNoMismatch(model, data, tenantId);
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>), tenantId };

  const rels = RELATIONS.get(model);
  if (rels) {
    for (const [field, target] of rels) {
      if (!TENANT_MODELS.has(target)) continue;
      const nested = out[field];
      if (!nested || typeof nested !== 'object') continue;
      const n = { ...(nested as Record<string, unknown>) };
      let touched = false;
      for (const verb of ['create', 'createMany'] as const) {
        if (n[verb] === undefined) continue;
        const payload = verb === 'createMany'
          ? { ...(n[verb] as Record<string, unknown>),
              data: stampCreateData(target, (n[verb] as Record<string, unknown>).data, tenantId) }
          : stampCreateData(target, n[verb], tenantId);
        n[verb] = payload;
        touched = true;
      }
      if (n.connectOrCreate !== undefined) {
        const coc = n.connectOrCreate;
        const one = (c: unknown) =>
          c && typeof c === 'object'
            ? { ...(c as Record<string, unknown>), create: stampCreateData(target, (c as Record<string, unknown>).create, tenantId) }
            : c;
        n.connectOrCreate = Array.isArray(coc) ? coc.map(one) : one(coc);
        touched = true;
      }
      if (touched) out[field] = n;
    }
  }
  return out;
}

/**
 * The whole guard, as one pure function.
 *
 * Returns the arguments to run and what the caller must verify afterwards.
 * Throws only for conditions that are always a bug: no tenant in context, or a
 * query that names a different tenant than the request is acting as.
 */
export function applyTenantGuard(
  model: string | undefined,
  operation: string,
  args: unknown,
  ctx: GuardContext,
): GuardDecision {
  if (ctx.mode === 'off') return PASS;
  if (!model || !TENANT_MODELS.has(model)) return PASS;
  if (ctx.bypass) return PASS;

  const { tenantId } = ctx;
  if (!tenantId) {
    // Fail LOUD. Returning every tenant's rows is a leak; returning none is
    // silent data loss that looks like an empty account. Throwing is what
    // forces crons, seeds and public routes to declare their scope.
    const err = new TenantContextMissingError(`${model}.${operation} is tenant-scoped`);
    if (ctx.mode === 'enforce') throw err;
    warn(`${model}.${operation} ran with NO TENANT in context`);
    return PASS;
  }

  const a = (args ?? {}) as Record<string, unknown>;

  // ---- reads and bulk writes: merge the filter -----------------------------
  if (FILTER_OPS.has(operation)) {
    assertOrWarn(ctx, () => assertNoMismatch(model, a.where, tenantId));
    if (ctx.mode === 'warn' && !mentionsTenant(a.where)) {
      warn(`${model}.${operation} would have been filtered by tenantId — its where clause names no tenant`);
    }
    const next = { ...a, where: mergeWhere(a.where, tenantId) };
    // updateMany/deleteMany also carry no per-row tenantId to stamp — the
    // where is what confines which rows are touched.
    return decide(ctx, next, 'filtered by tenantId');
  }

  // ---- findUnique: post-check rather than rewrite --------------------------
  //
  // The plan called for rewriting these to findFirst with the filter merged in.
  // Post-checking the returned row is better on two counts: a rewrite would
  // have to be dispatched on the base client, which runs OUTSIDE an enclosing
  // interactive $transaction and would therefore miss its uncommitted rows;
  // and it would lose findUnique's query batching. The row never reaches the
  // caller either way.
  if (UNIQUE_READ_OPS.has(operation)) {
    assertOrWarn(ctx, () => assertNoMismatch(model, a.where, tenantId));
    // `select` may omit tenantId, leaving nothing to check against. In
    // `enforce` we add it and the extension strips it back out; in `warn` we
    // leave the arguments completely untouched and simply skip the check for
    // that (rare) shape, because warn mode must not alter a single query.
    const sel = a.select as Record<string, unknown> | undefined;
    const selectHidesTenant = !!sel && !('tenantId' in sel);
    if (ctx.mode === 'warn') {
      // `args: undefined` is the sentinel for "run exactly what the caller
      // wrote" — used uniformly so warn mode is trivially auditable.
      return { args: undefined, checkResultTenant: !selectHidesTenant, note: 'result checked against tenantId' };
    }
    const next = selectHidesTenant ? { ...a, select: { ...sel, tenantId: true } } : a;
    return { args: next, checkResultTenant: true, note: 'result checked against tenantId' };
  }

  // ---- creates: stamp -----------------------------------------------------
  if (CREATE_OPS.has(operation)) {
    if (ctx.mode === 'warn') {
      // stampCreateData also performs the mismatch assertion, so run it for
      // its diagnostics and discard the result.
      assertOrWarn(ctx, () => { stampCreateData(model, a.data, tenantId); });
      return { args: undefined, note: 'tenantId stamped onto create data' };
    }
    const next = { ...a, data: stampCreateData(model, a.data, tenantId) };
    return { args: next, note: 'tenantId stamped onto create data' };
  }

  // ---- single-record writes ----------------------------------------------
  //
  // These cannot be rewritten: Prisma 5 requires a unique `where`, and adding
  // tenantId to it is not valid input. Instead the extension's existing
  // before-row read is checked — a row that exists under ANOTHER tenant is
  // refused. A before-row of null is NOT refused: it means the row does not
  // exist (Prisma raises its own P2025) or is uncommitted in this transaction,
  // and neither is a cross-tenant access.
  if (SINGLE_WRITE_OPS.has(operation)) {
    assertOrWarn(ctx, () => {
      assertNoMismatch(model, a.where, tenantId);
      if (operation === 'upsert') assertNoMismatch(model, a.create, tenantId);
    });
    let next = a;
    if (operation === 'upsert') {
      next = { ...a, create: stampCreateData(model, a.create, tenantId) };
    }
    return decide(ctx, next, 'before-row checked against tenantId', { checkBeforeTenant: true });
  }

  return PASS;
}

/**
 * Verify a row read before a single-record write belongs to this tenant.
 * Separate from applyTenantGuard so the guard itself stays pure.
 */
export function assertBeforeRowInTenant(
  model: string,
  before: Record<string, unknown> | null,
  ctx: GuardContext,
): void {
  if (ctx.mode === 'off' || ctx.bypass || !ctx.tenantId || !before) return;
  const rowTenant = before.tenantId;
  if (typeof rowTenant !== 'string' || rowTenant === ctx.tenantId) return;
  const err = new ForeignTenantRowError(model);
  if (ctx.mode === 'enforce') throw err;
  warn(`${model}: single-record write targeted a row owned by tenant "${rowTenant}" while acting as "${ctx.tenantId}"`);
}

// ---------------------------------------------------------------------------
// Mode plumbing
// ---------------------------------------------------------------------------

function decide(
  ctx: GuardContext,
  args: unknown,
  note: string,
  extra: Omit<GuardDecision, 'args' | 'note'> = {},
): GuardDecision {
  if (ctx.mode === 'enforce') return { args, note, ...extra };
  // warn: the ARGUMENTS are left exactly as the caller wrote them. The
  // verification flags are kept, because detecting a foreign row costs nothing
  // and reporting one is the whole reason to run in this mode.
  return { args: undefined, note, ...extra };
}

/**
 * Does this where clause already constrain the tenant?
 *
 * Used only to decide whether warn mode should say anything. Logging every
 * filtered query would bury the signal in the ~95% of call sites that were
 * already correct, so only queries the guard would genuinely have narrowed get
 * reported.
 *
 * Relation-based scoping (`{ purchase: { tenantId } }`) reads as unscoped here
 * and will produce a false positive. That is the right way round: a false
 * positive costs a log line, a false negative costs a missed leak.
 */
export function mentionsTenant(where: unknown, depth = 0): boolean {
  if (!where || typeof where !== 'object' || depth > 3) return false;
  if (Array.isArray(where)) return where.some((w) => mentionsTenant(w, depth + 1));
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === 'tenantId') return true;
    if ((key === 'AND' || key === 'OR' || key === 'NOT') && mentionsTenant(value, depth + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * In `warn` mode a mismatch is reported, not thrown — flipping the mode must
 * never be the first time anyone hears about a broken query.
 */
function assertOrWarn(ctx: GuardContext, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (ctx.mode === 'enforce') throw err;
    warn((err as Error).message);
  }
}

function warn(message: string): void {
  console.warn(`[tenant-guard] ${message}`);
}
