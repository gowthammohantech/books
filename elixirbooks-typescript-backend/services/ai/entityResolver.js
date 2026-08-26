const Customer = require("@models/Customer");
const Supplier = require("@models/Supplier");
const Product = require("@models/Product");
const TaxGroup = require("@models/TaxGroup");
const TaxRate = require("@models/TaxRate");
const ExpenseCategory = require("@models/ExpenseCategory");
const Currency = require("@models/Currency");
const BankDetail = require("@models/BankDetail");
const PaymentMode = require("@models/PaymentMode");
const userSupplier = require("@models/User");

/**
 * Load context data from the database for AI prompt processing
 * @param {string} userId - The authenticated user's ID
 * @returns {object} Context data for the AI prompt
 */
async function loadContext(userId) {
  const [customers, suppliers, products, taxGroups, expenseCategories,banks,paymentModes,userSuppliers] =
    await Promise.all([
      Customer.find({ isDeleted: false, userId })
        .select("name email phone _id")
        .sort({ name: 1 })
        .limit(200)
        .lean(),
      Supplier.find({ isDeleted: false, user_id: userId })
        .select("supplier_name supplier_email _id")
        .sort({ supplier_name: 1 })
        .limit(200)
        .lean(),
      Product.find({ status: true })
        .select("name code selling_price purchase_price item_type _id")
        .sort({ name: 1 })
        .limit(200)
        .lean(),
      TaxGroup.find({ status: true })
        .select("tax_name tax_rate_ids _id")
        .populate("tax_rate_ids", "tax_name tax_rate")
        .lean(),
      ExpenseCategory.find({ isDeleted: false, status: true })
        .select("title _id")
        .lean(),
      BankDetail.find({ isDeleted: false, status: true, userId }).select("bankName accountHoldername accountNumber accountType _id").lean(),
      PaymentMode.find({ status: true }).select("name slug _id").lean(),
      userSupplier.find({ user_type: 2 }).select("firstName lastName email phone _id").lean(),
    ]);

  return { customers, suppliers, products, taxGroups, expenseCategories,banks,paymentModes,userSuppliers };
}

/**
 * Resolve extracted AI entities against the database
 * Matches fuzzy names to actual DB records
 * @param {object} extractedData - The AI-extracted data
 * @param {object} context - Database context from loadContext
 * @returns {object} Resolved data with matched IDs
 */
function resolveEntitiesold(extractedData, context) {
  const resolved = { ...extractedData };
  const matchDetails = {
    customerMatch: null,
    vendorMatch: null,
    productMatches: [],
    taxGroupMatch: null,
    expenseCategoryMatch: null,
  };

  // Resolve customer
  if (extractedData.customerName && context.customers.length > 0) {
    const match = fuzzyMatch(
      extractedData.customerName,
      context.customers,
      "name"
    );
    if (match) {
      resolved.customerId = match._id;
      resolved.customerName = match.name;
      matchDetails.customerMatch = {
        id: match._id,
        name: match.name,
        confidence: match._matchScore,
      };
    }
  }

  // Resolve vendor/supplier
  if (extractedData.vendorName && context.suppliers.length > 0) {
    const match = fuzzyMatch(
      extractedData.expenseCategory,
      context.expenseCategories,
      "title"
    );
    if (match) {
      resolved.expenseCategoryId = match._id;
      resolved.expenseCategory = match.title;
      matchDetails.expenseCategoryMatch = {
        id: match._id,
        title: match.title,
        confidence: match._matchScore,
      };
    }
  }

  return { resolved, matchDetails };
}

function resolveEntities(extractedData, documentType, context) {
  const resolved = { ...extractedData };
  const matchDetails = {
    customerMatch: null,
    vendorMatch: null,
    productMatches: [],
    taxGroupMatch: null,
    expenseCategoryMatch: null,
    bankMatch: null,
    paymentModeMatch: null,
  };

  const ambiguities = {}; // NEW

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
    resolved.items = extractedData.items.map((item) => {
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
 * Fuzzy match a search term against a list of records
 */
function fuzzyMatch(searchTerm, records, fieldName) {
  if (!searchTerm || !records.length) return null;

  const normalized = searchTerm.toLowerCase().trim();

  // Exact match first
  const exact = records.find(
    (r) => r[fieldName] && r[fieldName].toLowerCase() === normalized
  );
  if (exact) return { ...exact, _matchScore: 1.0 };

  // Contains match
  const contains = records.find(
    (r) => r[fieldName] && r[fieldName].toLowerCase().includes(normalized)
  );
  if (contains) return { ...contains, _matchScore: 0.8 };

  // Reverse contains
  const reverseContains = records.find(
    (r) => r[fieldName] && normalized.includes(r[fieldName].toLowerCase())
  );
  if (reverseContains) return { ...reverseContains, _matchScore: 0.7 };

  // Word-level matching
  const searchWords = normalized.split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;

  for (const record of records) {
    if (!record[fieldName]) continue;
    const recordWords = record[fieldName].toLowerCase().split(/\s+/);
    const matchingWords = searchWords.filter((sw) =>
      recordWords.some(
        (rw) => rw.includes(sw) || sw.includes(rw)
      )
    );
    const score = matchingWords.length / Math.max(searchWords.length, recordWords.length);
    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestMatch = { ...record, _matchScore: score };
    }
  }

  return bestMatch;
}

function fuzzyMatchAll(searchTerm, records, fieldName) {
  if (!searchTerm || !records.length) return [];

  const normalized = searchTerm.toLowerCase().trim();
  const results = [];

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
      recordWords.some(rw => rw === sw) 
    );
    const score = matchingWords.length / searchWords.length;
    if (score >= 0.75) {
      results.push({ ...record, _matchScore: score });
    }
  }

  const seen = new Map();
  for (const r of results) {
    const key = String(r._id);
    if (!seen.has(key) || seen.get(key)._matchScore < r._matchScore) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b._matchScore - a._matchScore);
}

/**
 * Find the best matching tax group
 */
function findTaxGroup(taxInfo, taxGroups) {
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
          (sum, r) => sum + (r.tax_rate || 0),
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

module.exports = { loadContext, resolveEntities };

module.exports = { loadContext, resolveEntities };
