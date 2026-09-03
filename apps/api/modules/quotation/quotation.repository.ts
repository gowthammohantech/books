/**
 * Every Prisma call the Quotations API makes, in one place.
 *
 * Follows `modules/product/product.repository.ts`: the shared client arrives by
 * default parameter (the tenant suites mock the `lib/prisma` MODULE and assert
 * on delegate arguments), and every method awaits internally so no un-awaited
 * thenable escapes the AsyncLocalStorage tenant scope.
 *
 * WHAT IS DIFFERENT HERE, AND WHY IT MATTERS
 *
 * The Products repository was a pure move: it reproduced shapes it disagreed
 * with, unscoped `where` included, because the golden capture had to come out
 * byte-identical. This one does not, and the reason is a security defect the
 * golden harness reproduced over HTTP before a line of this file existed.
 *
 * `quotationController` resolved a quotation by id with `where: { id }` in five
 * handlers — get, update, delete, status and email — with no `tenantId`. The
 * capture, driven with tenant A's token against tenant B's quotation id, got:
 *
 *     GET    /api/admin/quotations/<B's id>            200  full document
 *     PUT    /api/admin/quotations/<B's id>            200  notes overwritten
 *     PATCH  /api/admin/quotations-status/<B's id>     200  status changed
 *     DELETE /api/admin/quotations/<B's id>            200  isDeleted = true
 *
 * `getQuotationById` even answers "Quotation not found or unauthorized" — the
 * authorization half of that sentence was never implemented. `tenantGuard`
 * ships in `warn` mode (`lib/tenantGuard.ts:139`), so it logged and let each
 * one through.
 *
 * So EVERY by-id method below takes a tenantId and puts it in the `where`. That
 * is a deliberate behaviour change, and the only one in this module: the golden
 * diff for the quotation endpoints is empty except for those four responses
 * turning into 404s. Same-tenant reads and writes are byte-identical.
 *
 * `findByIdUnscoped` exists for the one caller that must not be scoped — the
 * public share link, which is authenticated by token, not by session — and is
 * named so a reviewer has to notice it.
 */
import type { Prisma, PrismaClient, Quotation } from '@prisma/client';

import { prisma } from '../../lib/prisma';

/**
 * Relation shape for the detail read. Reproduced exactly from the controller:
 * both the contact and the legacy customer relations are loaded because the
 * response prefers the contact and falls back to the customer per document.
 */
const DETAIL_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true } },
  billToContact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true, vatRegNumber: true, gstin: true } },
  customer: { select: { id: true, name: true, email: true, phone: true, image: true, billingAddress: true } },
  billFromUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, profileImage: true, address: true, user_type: true } },
  billToCustomer: { select: { id: true, name: true, email: true, phone: true, image: true, billingAddress: true } },
  signature: { select: { id: true, signatureName: true, signatureImage: true } },
  bank: { select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
} as const;

/** Relation shape for LIST rows. Narrower than the detail read, exactly as found. */
const LIST_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
  billToContact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
  customer: { select: { id: true, name: true, email: true, phone: true, image: true } },
  billToCustomer: { select: { id: true, name: true, email: true, phone: true, image: true, billingAddress: true } },
  signature: { select: { id: true, signatureName: true } },
  bank: { select: { id: true, accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
} as const;

export type QuotationListRow = Prisma.QuotationGetPayload<{ include: typeof LIST_INCLUDE }>;

export type QuotationDetail = Prisma.QuotationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** The contact fields the party-resolution paths read. */
export interface ContactParty {
  id: string;
  defaultTaxTreatment: string | null;
}

export class QuotationRepository {
  private readonly db: PrismaClient;

  constructor(db: PrismaClient = prisma) {
    this.db = db;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * One quotation with its display relations, scoped to the tenant.
   *
   * The `tenantId` in this `where` is the fix described in the file docblock:
   * the controller's version omitted it and served other tenants' documents.
   */
  async findDetailById(id: string, tenantId: string): Promise<QuotationDetail | null> {
    return this.db.quotation.findFirst({
      where: { id, tenantId, isDeleted: false },
      include: DETAIL_INCLUDE,
    });
  }

  /** The bare row, scoped. Used by update/delete/status before they write. */
  async findById(id: string, tenantId: string): Promise<Quotation | null> {
    return this.db.quotation.findFirst({ where: { id, tenantId } });
  }

  /**
   * The bare row with NO tenant filter.
   *
   * The single legitimate unscoped read: a public share link carries its own
   * token and is resolved before any session exists, so there is no tenant to
   * scope by. Named to be conspicuous — nothing else may call it.
   */
  async findByIdUnscoped(id: string): Promise<Quotation | null> {
    return this.db.quotation.findUnique({ where: { id } });
  }

  /**
   * One page of quotations plus the matching total.
   *
   * `Promise.all`, not `$transaction`, because that is what the controller did:
   * a transaction would change the isolation the two reads see, and this method
   * is a move, not a redesign.
   */
  async list(
    where: Prisma.QuotationWhereInput,
    skip: number,
    take: number,
  ): Promise<[number, QuotationListRow[]]> {
    return Promise.all([
      this.db.quotation.count({ where }),
      this.db.quotation.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
  }

  /**
   * The next number the LIST previews.
   *
   * Ordered by `quotationId` where the create path orders by `createdAt`
   * (`generateNextQuotationId`). The two can disagree — a back-dated document
   * makes the preview and the issued number differ — but reconciling them would
   * change which number a tenant's next quotation gets, so it is preserved and
   * recorded rather than fixed here.
   */
  async findLastNumberByNumber(tenantId: string): Promise<string | null> {
    const last = await this.db.quotation.findFirst({
      where: { tenantId, quotationId: { not: null } },
      orderBy: { quotationId: 'desc' },
      select: { quotationId: true },
    });
    return last?.quotationId ?? null;
  }

  /**
   * The tenant's most recent quotation number, for the next-in-series preview.
   * Tenant-scoped: an install-wide read would continue another company's series.
   */
  async findLastNumber(tenantId: string): Promise<string | null> {
    const last = await this.db.quotation.findFirst({
      where: { tenantId, quotationId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { quotationId: true },
    });
    return last?.quotationId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async create(data: Prisma.QuotationCreateInput | Prisma.QuotationUncheckedCreateInput): Promise<Quotation> {
    return this.db.quotation.create({ data });
  }

  /**
   * Update one quotation, scoped.
   *
   * `updateMany` rather than `update`: `update` takes a unique `where`, which
   * cannot carry a non-unique `tenantId`, so scoping it needs either a compound
   * unique that does not exist on this model or a check-then-write with a TOCTOU
   * gap. `updateMany` accepts the full filter and reports how many rows matched,
   * which is exactly the authorization answer the caller needs.
   */
  async update(id: string, tenantId: string, data: Prisma.QuotationUpdateInput): Promise<Quotation | null> {
    const { count } = await this.db.quotation.updateMany({
      where: { id, tenantId },
      data: data as Prisma.QuotationUpdateManyMutationInput,
    });
    if (count === 0) return null;
    return this.db.quotation.findFirst({ where: { id, tenantId } });
  }

  /** Soft delete, scoped. Returns null when the id belongs to another tenant. */
  async softDelete(id: string, tenantId: string): Promise<Quotation | null> {
    return this.update(id, tenantId, { isDeleted: true });
  }

  // ---------------------------------------------------------------------------
  // Neighbours the quotation flow reads
  // ---------------------------------------------------------------------------

  /** A contact this tenant owns. Already scoped in the controller; kept scoped. */
  async findOwnedContact(id: string, tenantId: string): Promise<ContactParty | null> {
    return this.db.contact.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true, defaultTaxTreatment: true },
    }) as unknown as Promise<ContactParty | null>;
  }

  /** Back-resolve a contact from the legacy Customer id it was migrated from. */
  async findContactByLegacyCustomer(legacyCustomerId: string, tenantId: string): Promise<ContactParty | null> {
    return this.db.contact.findFirst({
      where: { legacyCustomerId, tenantId, isDeleted: false },
      select: { id: true, defaultTaxTreatment: true },
    }) as unknown as Promise<ContactParty | null>;
  }

  /**
   * The tenant's customers, for the picker.
   *
   * `tenantId` here is the second half of the fix: `getAllCustomers` filtered on
   * `isDeleted` alone, so `GET /api/admin/customers-all` — which the web app
   * calls on every quotation form — returned every tenant's customer list.
   */
  async listCustomers(tenantId: string, where: Prisma.CustomerWhereInput) {
    return this.db.customer.findMany({
      where: { ...where, tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async findCustomerById(id: string, tenantId: string) {
    return this.db.customer.findFirst({ where: { id, tenantId } });
  }

  async findUserById(id: string) {
    // User is not a tenant model — membership is what binds a user to a tenant.
    return this.db.user.findUnique({ where: { id } });
  }
}

/** The shared instance handlers use; the class stays exported for tests. */
export const quotationRepository = new QuotationRepository();
