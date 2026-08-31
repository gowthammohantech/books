/**
 * services/ai/entityResolver.ts
 *
 * Prisma port of the former Mongoose `entityResolver.js`. Only `loadContext()`
 * ever touched the datastore — it loaded the tenant's customers, suppliers,
 * products, tax groups, expense categories, banks, payment modes and
 * supplier-users so the AI's extracted entity names could be matched against
 * real records. It queried a Mongo instance that no longer exists, so every
 * list came back empty and `resolveEntities` matched nothing.
 *
 * SECURITY NOTE: four of the eight Mongo queries (products, tax groups, expense
 * categories, supplier-users) carried NO tenant filter and so could match
 * another workspace's records. Every query below now names `tenantId`
 * explicitly. That is deliberate rather than delegated: lib/tenantGuard.ts
 * ships in `warn` mode (TENANT_GUARD_MODE), where it logs what it would have
 * filtered but passes the arguments through untouched — so the guard is
 * defence in depth here, not the control. `User` cannot be guarded at all (a
 * person belongs to N workspaces, so there is no `User.tenantId`) and is
 * scoped by hand through TenantMembership, the pattern lib/tenantMembers.ts
 * uses. `PaymentMode` is a genuinely global lookup table with no tenantId
 * column and is intentionally left unscoped.
 *
 * The ~450 lines of fuzzy-matching logic below `loadContext` are pure and are
 * carried across unchanged, including their use of `_id` as the record
 * identity. `loadContext` therefore maps Prisma's `id` to `_id` rather than
 * renaming the key at 40-odd call sites — the datastore changed, the matching
 * algorithm did not, and this keeps the port free of behavioural risk.
 * Likewise `tax_rates` (the Prisma many-to-many) is reshaped to the
 * `tax_rate_ids: [{ tax_name, tax_rate }]` form `findTaxGroup` expects.
 *
 * Dropped in the port: `resolveEntitiesold()` and the `fuzzyMatch()` helper it
 * alone called. Neither was exported and nothing reached them.
 */
import { prisma } from '../../lib/prisma';

/** A context/DB record flowing through the matchers; deliberately loose. */
type MatchRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ResolverContext {
  customers: MatchRecord[];
  suppliers: MatchRecord[];
  products: MatchRecord[];
  taxGroups: MatchRecord[];
  expenseCategories: MatchRecord[];
  banks: MatchRecord[];
  paymentModes: MatchRecord[];
  userSuppliers: MatchRecord[];
}

/** The matchers index records by `_id`; Prisma exposes `id`. */
function withMongoStyleId<T extends { id: string }>(row: T): Omit<T, 'id'> & { _id: string } {
  const { id, ...rest } = row;
  return { ...rest, _id: id };
}

/**
 * Load context data from the database for AI prompt processing.
 * @param tenantId - the caller's tenant (workspace)
 */
async function loadContext(tenantId: string): Promise<ResolverContext> {
  const [
    customers,
    suppliers,
    products,
    taxGroups,
    expenseCategories,
    banks,
    paymentModes,
    userSuppliers,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: { isDeleted: false, tenantId },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.supplier.findMany({
      where: { isDeleted: false, tenantId },
      select: { id: true, supplier_name: true, supplier_email: true },
      orderBy: { supplier_name: 'asc' },
      take: 200,
    }),
    prisma.product.findMany({
      where: { status: true, tenantId },
      select: {
        id: true,
        name: true,
        code: true,
        selling_price: true,
        purchase_price: true,
        item_type: true,
      },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.taxGroup.findMany({
      where: { status: true, tenantId },
      select: {
        id: true,
        tax_name: true,
        tax_rates: { select: { id: true, name: true, rate: true } },
      },
    }),
    prisma.expenseCategory.findMany({
      where: { isDeleted: false, status: true, tenantId },
      select: { id: true, title: true },
    }),
    prisma.bankDetail.findMany({
      where: { isDeleted: false, status: true, tenantId },
      select: {
        id: true,
        bankName: true,
        accountHoldername: true,
        accountNumber: true,
        accountType: true,
      },
    }),
    // PaymentMode is a global lookup table — no tenantId column in the schema.
    prisma.paymentMode.findMany({
      where: { status: true },
      select: { id: true, name: true, slug: true },
    }),
    prisma.user.findMany({
      where: {
        user_type: 2,
        isDeleted: false,
        memberships: { some: { tenantId, status: 'ACTIVE' } },
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    }),
  ]);

  return {
    customers: customers.map(withMongoStyleId),
    suppliers: suppliers.map(withMongoStyleId),
    products: products.map((p) => ({
      ...withMongoStyleId(p),
      selling_price: Number(p.selling_price),
      purchase_price: Number(p.purchase_price),
    })),
    // findTaxGroup() reads `tax_rate_ids[].tax_rate`; Prisma models the same
    // link as the `tax_rates` many-to-many with `name`/`rate` columns.
    taxGroups: taxGroups.map((g) => ({
      _id: g.id,
      tax_name: g.tax_name,
      tax_rate_ids: g.tax_rates.map((r) => ({
        _id: r.id,
        tax_name: r.name,
        tax_rate: Number(r.rate),
      })),
    })),
    expenseCategories: expenseCategories.map(withMongoStyleId),
    banks: banks.map(withMongoStyleId),
    paymentModes: paymentModes.map(withMongoStyleId),
    userSuppliers: userSuppliers.map(withMongoStyleId),
  };
}

function resolveEntities(
  extractedData: MatchRecord,
  documentType: string,
  context: ResolverContext,
) {
  const resolved: MatchRecord = { ...extractedData };
  const matchDetails: MatchRecord = {
    customerMatch: null,
    vendorMatch: null,
    productMatches: [],
    taxGroupMatch: null,
    expenseCategoryMatch: null,
    bankMatch: null,
    paymentModeMatch: null,
  };

  const ambiguities: MatchRecord = {}; // NEW

  if (resolved.paymentSource) {
    resolved.paymentSource = resolved.paymentSource.toString().toUpperCase().trim();
  } else if (documentType === "expense") {
    resolved.paymentSource = "PETTY_CASH";
  }
  // Customer resolution
  if (extractedData.customerName && context.customers.length > 0 && documentType !== 'expense') {
    const matches = fuzzyMatchAll(extractedData.customerName, context.customers, "name");
    if (matches.length === 1) {
      // Single match — proceed as before
      resolved.customerId = matches[0]._id;
      resolved.customerName = matches[0].name;
      matchDetails.customerMatch = { id: matches[0]._id, name: matches[0].name, confidence: matches[0]._matchScore };
    } else if (matches.length > 1) {
      // Multiple matches — flag as ambiguous, do NOT pick one
      resolved.customerId = null;
      ambiguities.customer = {
        searchTerm: extractedData.customerName,
        matches: matches.map(m => ({ id: m._id, name: m.name, email: m.email })),
      };
    } else {
      // No match
      resolved.customerId = null;
      ambiguities.customer = {
        searchTerm: extractedData.customerName,
        matches: [],
        allAvailable: context.customers.map(c => ({ id: c._id, name: c.name })),
      };
    }
  }

  // Resolve vendor/supplier
  // if (extractedData.vendorName && context.suppliers.length > 0) {
  //   const matches = fuzzyMatchAll(extractedData.vendorName, context.suppliers, "supplier_name");
  //   if (matches.length === 1) {
  //     resolved.vendorId = matches[0]._id;
  //     resolved.vendorName = matches[0].supplier_name;
  //     matchDetails.vendorMatch = { id: matches[0]._id, name: matches[0].supplier_name, confidence: matches[0]._matchScore };
  //   } else if (matches.length > 1) {
  //     resolved.vendorId = null;
  //     ambiguities.vendor = {
  //       searchTerm: extractedData.vendorName,
  //       matches: matches.map(m => ({ id: m._id, name: m.supplier_name })),
  //     };
  //   } else {
  //     resolved.vendorId = null;
  //     ambiguities.vendor = {
  //       searchTerm: extractedData.vendorName,
  //       matches: [],
  //       allAvailable: context.suppliers.map(s => ({ id: s._id, name: s.supplier_name })),
  //     };
  //   }
  // }
  if(documentType !== 'expense') {
    if (extractedData.vendorName) {
      if (documentType === 'expense') {
        if (context.userSuppliers.length > 0) {
          const suppliersWithFullName = context.userSuppliers.map(s => ({
            ...s,
            fullName: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
          }));
          const matches = fuzzyMatchAll(extractedData.vendorName, suppliersWithFullName, "fullName");
          if (matches.length === 1) {
            resolved.vendorId = matches[0]._id;
            resolved.vendorName = matches[0].fullName;
            matchDetails.vendorMatch = {
              id: matches[0]._id,
              name: matches[0].fullName,
              confidence: matches[0]._matchScore,
            };
          } else if (matches.length > 1) {
            // Multiple matches — ask user to clarify, but still mark as optional
            resolved.vendorId = null;
            ambiguities.vendor = {
              searchTerm: extractedData.vendorName,
              matches: matches.map(m => ({ id: m._id, name: m.fullName })),
              optional: true,
            };
          }
        } else {
          resolved.vendorId = null;
          resolved.vendorName = null;
        }
      }
      else {
        const suppliersWithFullName = context.userSuppliers.map(s => ({
          ...s,
          fullName: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
        }));
        if (suppliersWithFullName.length === 0) {
          resolved.vendorId = null;
          ambiguities.vendor = { searchTerm: extractedData.vendorName, matches: [] };
        } else {
          const matches = fuzzyMatchAll(extractedData.vendorName, suppliersWithFullName, "fullName");
          if (matches.length === 1) {
            resolved.vendorId = matches[0]._id;
            resolved.vendorName = matches[0].fullName;
            matchDetails.vendorMatch = {
              id: matches[0]._id,
              name: matches[0].fullName,
              confidence: matches[0]._matchScore,
            };
          } else if (matches.length > 1) {
            resolved.vendorId = null;
            ambiguities.vendor = {
              searchTerm: extractedData.vendorName,
              matches: matches.map(m => ({ id: m._id, name: m.fullName })),
            };
          } else {
            resolved.vendorId = null;
            ambiguities.vendor = { searchTerm: extractedData.vendorName, matches: [] };
          }
        }
      }
    }
  }

  // Resolve products in items
  if (extractedData.items && context.products.length > 0 && documentType !== 'expense') {
    ambiguities.products = [];
    resolved.items = extractedData.items.map((item: MatchRecord) => {
      const matches = fuzzyMatchAll(item.name, context.products, "name");
      if (matches.length === 1) {
        const m = matches[0];
        const rate = item.rate || m.selling_price;
        matchDetails.productMatches.push({ original: item.name, matched: m.name, id: m._id, confidence: m._matchScore });
        return { ...item, productId: m._id, name: m.name, code: m.code, rate, amount: (item.quantity || 1) * rate };
      } else if (matches.length > 1) {
        ambiguities.products.push({
          searchTerm: item.name,
          matches: matches.map(m => ({ id: m._id, name: m.name, price: m.selling_price, code: m.code })),
        });
        return null;
      } else {
        ambiguities.products.push({
          searchTerm: item.name,
          matches: [],
          allAvailable: context.products.map(p => ({ id: p._id, name: p.name, price: p.selling_price })),
        });
        return null; // exclude not-found item
      }
    }).filter(Boolean);
  }


  // Resolve tax group based on tax type and rate
  if (
    extractedData.tax &&
    extractedData.tax.type !== "none" &&
    context.taxGroups.length > 0
  ) {
    const taxMatch = findTaxGroup(extractedData.tax, context.taxGroups);
    if (taxMatch) {
      resolved.taxGroupId = taxMatch._id;
      resolved.taxGroupName = taxMatch.tax_name;
      matchDetails.taxGroupMatch = {
        id: taxMatch._id,
        name: taxMatch.tax_name,
      };
    }
  }

  // Resolve expense category
  if (documentType === 'expense' && extractedData.expenseCategory && context.expenseCategories.length > 0) {
    const catMatches = fuzzyMatchAll(extractedData.expenseCategory, context.expenseCategories, "title");
    if (catMatches.length === 1) {
      resolved.expenseCategoryId = catMatches[0]._id;
      resolved.expenseCategory = catMatches[0].title;
      matchDetails.expenseCategoryMatch = { id: catMatches[0]._id, title: catMatches[0].title, confidence: catMatches[0]._matchScore };
    } else if (catMatches.length > 1) {
      resolved.expenseCategoryId = null;
      ambiguities.expenseCategory = {
        searchTerm: extractedData.expenseCategory,
        matches: catMatches.map(c => ({ id: c._id, name: c.title })),
      };
    } else {
      resolved.expenseCategoryId = null;
      ambiguities.expenseCategory = {
        searchTerm: extractedData.expenseCategory,
        matches: [],
      };
    }
  }

  if (documentType === "expense" && resolved.paymentSource === "BANK") {
    if (!context.banks || context.banks.length === 0) {
      resolved.bankId = null;
      ambiguities.bank = {
        searchTerm: extractedData.bankName || null,
        matches: [],
      };
    } else if (extractedData.bankName) {
      const bankByName = fuzzyMatchAll(extractedData.bankName, context.banks, "bankName");
      const bankByHolder = fuzzyMatchAll(
        extractedData.bankName,
        context.banks,
        "accountHoldername"
      );
      const allBankMatches = [...bankByName, ...bankByHolder].filter(
        (b, i, arr) =>
          arr.findIndex((x) => String(x._id) === String(b._id)) === i
      );

      if (allBankMatches.length === 1) {
        resolved.bankId = allBankMatches[0]._id;
        resolved.bankName = allBankMatches[0].bankName;
        matchDetails.bankMatch = {
          id: allBankMatches[0]._id,
          name: allBankMatches[0].bankName,
        };
      } else if (allBankMatches.length > 1) {
        resolved.bankId = null;
        ambiguities.bank = {
          searchTerm: extractedData.bankName,
          matches: allBankMatches.map((b) => ({
            id: b._id,
            name: b.bankName,
            accountNumber: b.accountNumber,
          })),
        };
      } else {
        resolved.bankId = null;
        ambiguities.bank = {
          searchTerm: extractedData.bankName,
          matches: [],
          allAvailable: context.banks.map((b) => ({
            id: b._id,
            name: b.bankName,
            accountNumber: b.accountNumber,
          })),
        };
      }
    } else {
      if (context.banks.length === 1) {
        resolved.bankId = context.banks[0]._id;
        resolved.bankName = context.banks[0].bankName;
        matchDetails.bankMatch = {
          id: context.banks[0]._id,
          name: context.banks[0].bankName,
        };
      } else {
        resolved.bankId = null;
        ambiguities.bank = {
          searchTerm: null,
          matches: context.banks.map((b) => ({
            id: b._id,
            name: b.bankName,
            accountNumber: b.accountNumber,
          })),
        };
      }
    }
  }

  if (documentType === "expense" && resolved.paymentSource === "BANK") {
    if (!context.paymentModes || context.paymentModes.length === 0) {
      resolved.paymentMode = null;
    } else if (extractedData.paymentModeName) {
      const pmMatches = fuzzyMatchAll(
        extractedData.paymentModeName,
        context.paymentModes,
        "name"
      );
      if (pmMatches.length === 1) {
        resolved.paymentMode = pmMatches[0]._id;
        resolved.paymentModeName = pmMatches[0].name;
        matchDetails.paymentModeMatch = {
          id: pmMatches[0]._id,
          name: pmMatches[0].name,
        };
      } else if (pmMatches.length > 1) {
        resolved.paymentMode = null;
        ambiguities.paymentMode = {
          searchTerm: extractedData.paymentModeName,
          matches: pmMatches.map((m) => ({ id: m._id, name: m.name })),
        };
      } else {
        resolved.paymentMode = null;
        ambiguities.paymentMode = {
          searchTerm: extractedData.paymentModeName,
          matches: [],
        };
      }
    } else {
      if (context.paymentModes.length === 1) {
        resolved.paymentMode = context.paymentModes[0]._id;
        resolved.paymentModeName = context.paymentModes[0].name;
        matchDetails.paymentModeMatch = {
          id: context.paymentModes[0]._id,
          name: context.paymentModes[0].name,
        };
      } else {
        resolved.paymentMode = null;
        ambiguities.paymentMode = {
          searchTerm: null,
          matches: context.paymentModes.map((m) => ({ id: m._id, name: m.name })),
        };
      }
    }
  }
  
  return { resolved, matchDetails, ambiguities };
}

/**
 * Fuzzy match a search term against every record, returning all candidates
 * ordered by score. An exact (case-insensitive) hit short-circuits to a single
 * result; otherwise contains / reverse-contains / word-overlap each score in.
 */
function fuzzyMatchAll(
  searchTerm: string | null | undefined,
  records: MatchRecord[],
  fieldName: string,
): MatchRecord[] {
  if (!searchTerm || !records.length) return [];

  const normalized = searchTerm.toLowerCase().trim();
  const results: MatchRecord[] = [];

  for (const record of records) {
    if (!record[fieldName]) continue;
    const recordValue = record[fieldName].toLowerCase().trim();

    if (recordValue === normalized) {
      return [{ ...record, _matchScore: 1.0 }];
    }

    if (recordValue.includes(normalized)) {
      results.push({ ...record, _matchScore: 0.85 });
      continue;
    }

    const recordWords = recordValue.split(/\s+/);
    if (normalized.includes(recordValue) && recordWords.length >= 2) {
      results.push({ ...record, _matchScore: 0.75 });
      continue;
    }

    const searchWords = normalized.split(/\s+/);
    const matchingWords = searchWords.filter(sw =>
      recordWords.some((rw: string) => rw === sw)
    );
    const score = matchingWords.length / searchWords.length;
    if (score >= 0.75) {
      results.push({ ...record, _matchScore: score });
    }
  }

  const seen = new Map<string, MatchRecord>();
  for (const r of results) {
    const key = String(r._id);
    if (!seen.has(key) || seen.get(key)!._matchScore < r._matchScore) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b._matchScore - a._matchScore);
}

/**
 * Find the best matching tax group
 */
function findTaxGroup(taxInfo: MatchRecord, taxGroups: MatchRecord[]): MatchRecord | null {
  if (!taxInfo || !taxGroups.length) return null;

  // Try matching by name first
  const taxTypeName = taxInfo.type.toUpperCase();
  for (const group of taxGroups) {
    const groupName = group.tax_name.toUpperCase();
    if (groupName.includes(taxTypeName) || taxTypeName.includes(groupName)) {
      return group;
    }
  }

  // Try matching by rate
  if (taxInfo.rate) {
    for (const group of taxGroups) {
      if (group.tax_rate_ids && group.tax_rate_ids.length > 0) {
        const totalRate = group.tax_rate_ids.reduce(
          (sum: number, r: MatchRecord) => sum + (r.tax_rate || 0),
          0
        );
        if (totalRate === taxInfo.rate) {
          return group;
        }
      }
    }
  }

  return null;
}

export { loadContext, resolveEntities };
