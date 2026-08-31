/**
 * Scoped demo-data purge — removes ALL data owned by the demo tenant
 * (admin@demo.elixirbooks.local / demo-admin-1) while leaving baseline/global
 * lookup tables and any OTHER tenant completely untouched.
 *
 * DRY RUN by default — prints per-table row counts with NO writes.
 * Pass --confirm (or env CONFIRM=yes) to actually delete.
 *
 * Usage:
 *   npx ts-node prisma/clear-demo.ts              # dry run
 *   npx ts-node prisma/clear-demo.ts --confirm    # execute
 *   CONFIRM=yes npx ts-node prisma/clear-demo.ts  # execute via env
 *
 * npm: prisma:clear:demo
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Payroll models (PayrollProfile/PayRun/PayRunLine) may be absent from a stale
// locally-generated client even though they exist in schema + DB. Reach them via
// an untyped delegate accessor — same cast pattern the payroll controllers use —
// so the purge works whether or not `prisma generate` has been re-run locally.
const px = prisma as unknown as Record<string, { count: (a: unknown) => Promise<number> }>;

const DEMO_EMAIL = 'admin@demo.elixirbooks.local';
const DEMO_OWNER_ID = 'demo-admin-1';

const confirm =
  process.argv.includes('--confirm') || process.env['CONFIRM'] === 'yes';

// ---------------------------------------------------------------------------
// Count helpers
// ---------------------------------------------------------------------------

async function countAiChatMessages(demoUserIds: string[]): Promise<number> {
  // AiChatMessage has no tenantId; scoped via AiChatSession.tenantId
  const sessions = await prisma.aiChatSession.findMany({
    where: { tenantId: { in: demoUserIds } },
    select: { id: true },
  });
  if (!sessions.length) return 0;
  return prisma.aiChatMessage.count({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
  });
}

async function countJournalLines(demoUserIds: string[]): Promise<number> {
  // JournalLine cascades with JournalEntry; count for information
  const entries = await prisma.journalEntry.findMany({
    where: { tenantId: { in: demoUserIds } },
    select: { id: true },
  });
  if (!entries.length) return 0;
  return prisma.journalLine.count({
    where: { journalEntryId: { in: entries.map((e) => e.id) } },
  });
}

// NOTE: PayrollProfile / PayRun / PayRunLine are in schema.prisma but the
// generated Prisma client pre-dates those migrations; they are NOT seeded
// by seed-demo-full.ts, so no demo data exists. Skip them entirely.

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Elixir Books demo purge ===');
  console.log(`Mode: ${confirm ? 'CONFIRMED — will delete' : 'DRY RUN — no writes'}`);

  // 1. Resolve demo owner
  const demoOwner = await prisma.user.findFirst({
    where: { email: DEMO_EMAIL },
  });

  if (!demoOwner) {
    console.log('Demo owner not found; nothing to purge.');
    return;
  }

  // 2. Collect demo user ids (owner + staff with ownerId = owner.id)
  const staffUsers = await prisma.user.findMany({
    where: { ownerId: demoOwner.id },
    select: { id: true },
  });
  const demoUserIds = [demoOwner.id, ...staffUsers.map((u) => u.id)];

  console.log(`\nDemo owner: ${demoOwner.email} (${demoOwner.id})`);
  console.log(`Demo users: ${demoUserIds.length} (owner + ${staffUsers.length} staff)\n`);

  // ---------------------------------------------------------------------------
  // 3. Count rows per model (what WOULD be deleted)
  // ---------------------------------------------------------------------------

  // --- Step 1: AI features (deepest children first) ---
  const cntAiChatMessage = await countAiChatMessages(demoUserIds);
  const cntAiChatSession = await prisma.aiChatSession.count({ where: { tenantId: { in: demoUserIds } } });
  const cntAiExtractionJob = await prisma.aiExtractionJob.count({ where: { tenantId: { in: demoUserIds } } });
  const cntAiUsageLog = await prisma.aiUsageLog.count({ where: { tenantId: { in: demoUserIds } } });
  const cntRefund = await prisma.refund.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 2: Payment infrastructure ---
  const cntPaymentTransaction = await prisma.paymentTransaction.count({ where: { tenantId: { in: demoUserIds } } });
  const cntPaymentLinkMethod = await prisma.paymentLinkMethod.count({ where: { tenantId: { in: demoUserIds } } });
  const cntEInvoiceRecord = await prisma.eInvoiceRecord.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 3: Invoice chain ---
  const cntInvoicePayment = await prisma.invoicePayment.count({
    where: { invoice: { tenantId: { in: demoUserIds } } },
  });
  const cntCreditNote = await prisma.creditNote.count({ where: { tenantId: { in: demoUserIds } } });
  const cntDeliveryChallan = await prisma.deliveryChallan.count({ where: { tenantId: { in: demoUserIds } } });
  const cntInvoice = await prisma.invoice.count({ where: { tenantId: { in: demoUserIds } } });
  const cntQuotation = await prisma.quotation.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 4: Expense chain ---
  const cntExpenseChangeLog = await prisma.expenseChangeLog.count({
    where: { expense: { tenantId: { in: demoUserIds } } },
  });
  const cntExpense = await prisma.expense.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 5: Purchase chain ---
  const cntSupplierPayment = await prisma.supplierPayment.count({
    where: { purchase: { tenantId: { in: demoUserIds } } },
  });
  const cntDebitNote = await prisma.debitNote.count({ where: { tenantId: { in: demoUserIds } } });
  const cntPurchase = await prisma.purchase.count({ where: { tenantId: { in: demoUserIds } } });
  const cntPurchaseOrder = await prisma.purchaseOrder.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 6: Bank + petty cash ---
  const cntBankTransaction = await prisma.bankTransaction.count({
    where: { bankAccount: { tenantId: { in: demoUserIds } } },
  });
  const cntBankDetail = await prisma.bankDetail.count({ where: { tenantId: { in: demoUserIds } } });
  const cntPettyCashTransaction = await prisma.pettyCashTransaction.count({
    where: { remarks: { startsWith: 'DEMO-PC' } },
  });
  // PettyCash rows that have zero transactions (left orphaned after demo txn deletion)
  const cntPettyCash = await prisma.pettyCash.count({
    where: { transactions: { none: {} } },
  });

  // --- Step 7: Payroll (Phase 2) — reached via untyped delegate (stale-client safe) ---
  const cntPayRunLine = await px['payRunLine']!.count({ where: { payRun: { tenantId: { in: demoUserIds } } } });
  const cntPayRun = await px['payRun']!.count({ where: { tenantId: { in: demoUserIds } } });
  const cntPayrollProfile = await px['payrollProfile']!.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 8: Journal / ledger / accounts ---
  const cntJournalLine = await countJournalLines(demoUserIds);
  const cntJournalEntry = await prisma.journalEntry.count({ where: { tenantId: { in: demoUserIds } } });
  const cntLedgerAccountMapping = await prisma.ledgerAccountMapping.count({ where: { tenantId: { in: demoUserIds } } });
  const cntAccountChild = await prisma.account.count({ where: { tenantId: { in: demoUserIds }, parentId: { not: null } } });
  const cntAccountParent = await prisma.account.count({ where: { tenantId: { in: demoUserIds }, parentId: null } });
  const cntAccountingPeriod = await prisma.accountingPeriod.count({ where: { tenantId: { in: demoUserIds } } });
  const cntBudget = await prisma.budget.count({ where: { tenantId: { in: demoUserIds } } });
  const cntFixedAsset = await prisma.fixedAsset.count({ where: { tenantId: { in: demoUserIds } } });
  const cntExchangeRate = await prisma.exchangeRate.count({ where: { tenantId: { in: demoUserIds } } });
  const cntCostCenter = await prisma.costCenter.count({ where: { tenantId: { in: demoUserIds } } });
  const cntProject = await prisma.project.count({ where: { tenantId: { in: demoUserIds } } });
  const cntTransactionCategory = await prisma.transactionCategory.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 9: Inventory + Products + TaxRate + ExpenseCategory ---
  const cntInventory = await prisma.inventory.count({
    where: {
      OR: [{ tenantId: { in: demoUserIds } }, { product: { code: { startsWith: 'DEMO-' } } }],
    },
  });
  const cntProduct = await prisma.product.count({ where: { tenantId: { in: demoUserIds }, code: { startsWith: 'DEMO-' } } });
  const cntTaxRate = await prisma.taxRate.count({ where: { tenantId: { in: demoUserIds } } });
  const cntExpenseCategory = await prisma.expenseCategory.count({ where: { tenantId: { in: demoUserIds }, title: { startsWith: 'Demo ' } } });

  // --- Step 10: Vehicles + Reminders + Customers + Suppliers ---
  const cntVehicle = await prisma.vehicle.count({ where: { tenantId: { in: demoUserIds } } });
  const cntReminder = await prisma.reminder.count({ where: { createdBy: { in: demoUserIds } } });
  const cntCustomer = await prisma.customer.count({ where: { tenantId: { in: demoUserIds } } });
  const cntSupplier = await prisma.supplier.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 11: Config models + Localization + CompanySettings ---
  const cntGatewayConfig = await prisma.gatewayConfig.count({ where: { tenantId: { in: demoUserIds } } });
  const cntMessagingConfig = await prisma.messagingConfig.count({ where: { tenantId: { in: demoUserIds } } });
  const cntAiConfig = await prisma.aiConfig.count({ where: { tenantId: { in: demoUserIds } } });
  const cntAccountingIntegration = await prisma.accountingIntegration.count({ where: { tenantId: { in: demoUserIds } } });
  const cntLocalization = await prisma.localization.count({ where: { tenantId: { in: demoUserIds } } });
  const cntCompanySettings = await prisma.companySettings.count({ where: { tenantId: { in: demoUserIds } } });

  // --- Step 12: Users (last) ---
  const cntStaffUsers = staffUsers.length;
  const cntOwnerUser = 1;

  // ---------------------------------------------------------------------------
  // Print counts table
  // ---------------------------------------------------------------------------
  const rows: [string, number][] = [
    // Step 1 — AI (deepest)
    ['AiChatMessage (cascade)', cntAiChatMessage],
    ['AiChatSession', cntAiChatSession],
    ['AiExtractionJob', cntAiExtractionJob],
    ['AiUsageLog', cntAiUsageLog],
    ['Refund', cntRefund],
    // Step 2 — Payment infra
    ['PaymentTransaction', cntPaymentTransaction],
    ['PaymentLinkMethod', cntPaymentLinkMethod],
    ['EInvoiceRecord', cntEInvoiceRecord],
    // Step 3 — Invoice chain
    ['InvoicePayment', cntInvoicePayment],
    ['CreditNote', cntCreditNote],
    ['DeliveryChallan', cntDeliveryChallan],
    ['Invoice', cntInvoice],
    ['Quotation', cntQuotation],
    // Step 4 — Expense chain
    ['ExpenseChangeLog', cntExpenseChangeLog],
    ['Expense', cntExpense],
    // Step 5 — Purchase chain
    ['SupplierPayment', cntSupplierPayment],
    ['DebitNote', cntDebitNote],
    ['Purchase', cntPurchase],
    ['PurchaseOrder', cntPurchaseOrder],
    // Step 6 — Bank + petty cash
    ['BankTransaction', cntBankTransaction],
    ['BankDetail', cntBankDetail],
    ['PettyCashTransaction (DEMO-PC*)', cntPettyCashTransaction],
    ['PettyCash (orphaned)', cntPettyCash],
    // Step 7 — Payroll (Phase 2)
    ['PayRunLine (cascade)', cntPayRunLine],
    ['PayRun', cntPayRun],
    ['PayrollProfile', cntPayrollProfile],
    // Step 8 — Journal / ledger / accounts
    ['JournalLine (cascade)', cntJournalLine],
    ['JournalEntry', cntJournalEntry],
    ['LedgerAccountMapping', cntLedgerAccountMapping],
    ['Account (child, parentId!=null)', cntAccountChild],
    ['Account (parent, parentId=null)', cntAccountParent],
    ['AccountingPeriod', cntAccountingPeriod],
    ['Budget', cntBudget],
    ['FixedAsset', cntFixedAsset],
    ['ExchangeRate', cntExchangeRate],
    ['CostCenter', cntCostCenter],
    ['Project', cntProject],
    ['TransactionCategory', cntTransactionCategory],
    // Step 9 — Inventory / products / tax / expense categories
    ['Inventory (demo)', cntInventory],
    ['Product (DEMO-*)', cntProduct],
    ['TaxRate', cntTaxRate],
    ['ExpenseCategory (Demo *)', cntExpenseCategory],
    // Step 10 — Vehicles / reminders / customers / suppliers
    ['Vehicle', cntVehicle],
    ['Reminder', cntReminder],
    ['Customer', cntCustomer],
    ['Supplier', cntSupplier],
    // Step 11 — Config
    ['GatewayConfig', cntGatewayConfig],
    ['MessagingConfig', cntMessagingConfig],
    ['AiConfig', cntAiConfig],
    ['AccountingIntegration', cntAccountingIntegration],
    ['Localization', cntLocalization],
    ['CompanySettings', cntCompanySettings],
    // Step 12 — Users (last)
    ['User (staff, ownerId=demo)', cntStaffUsers],
    ['User (owner)', cntOwnerUser],
  ];

  const maxLabel = Math.max(...rows.map(([l]) => l.length));
  console.log(`${'Model'.padEnd(maxLabel)}  Count`);
  console.log(`${'-'.repeat(maxLabel)}  -----`);
  for (const [label, count] of rows) {
    console.log(`${label.padEnd(maxLabel)}  ${count}`);
  }
  console.log('');

  // ---------------------------------------------------------------------------
  // 4. Dry run exit
  // ---------------------------------------------------------------------------
  if (!confirm) {
    console.log('DRY RUN — no rows deleted. Re-run with --confirm to execute.');
    return;
  }

  // ---------------------------------------------------------------------------
  // 5. Execute deletes inside a single transaction (child → parent order)
  // ---------------------------------------------------------------------------
  console.log('Executing purge inside a single transaction...');

  let totalDeleted = 0;
  const deletedCounts: Record<string, number> = {};

  function track(model: string, result: Prisma.BatchPayload): void {
    deletedCounts[model] = result.count;
    totalDeleted += result.count;
    if (result.count > 0) {
      console.log(`  [OK] ${model}: ${result.count} rows`);
    }
  }

  await prisma.$transaction(
    async (tx) => {
      // -----------------------------------------------------------------------
      // Step 1 — AI features (AiChatMessage cascades with AiChatSession)
      // -----------------------------------------------------------------------
      const sessionIds = (
        await tx.aiChatSession.findMany({
          where: { tenantId: { in: demoUserIds } },
          select: { id: true },
        })
      ).map((s) => s.id);

      if (sessionIds.length) {
        track(
          'AiChatMessage',
          await tx.aiChatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } }),
        );
      }
      track('AiChatSession', await tx.aiChatSession.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // NULL resultingPurchaseId before deleting jobs (unique FK to Purchase)
      await tx.aiExtractionJob.updateMany({
        where: { tenantId: { in: demoUserIds }, resultingPurchaseId: { not: null } },
        data: { resultingPurchaseId: null },
      });
      track('AiExtractionJob', await tx.aiExtractionJob.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('AiUsageLog', await tx.aiUsageLog.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Refund', await tx.refund.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 2 — Payment infrastructure
      // -----------------------------------------------------------------------
      // NULL paymentTransactionId on InvoicePayment before deleting transactions
      await tx.invoicePayment.updateMany({
        where: {
          paymentTransactionId: { not: null },
          invoice: { tenantId: { in: demoUserIds } },
        },
        data: { paymentTransactionId: null },
      });
      track('PaymentTransaction', await tx.paymentTransaction.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('PaymentLinkMethod', await tx.paymentLinkMethod.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('EInvoiceRecord', await tx.eInvoiceRecord.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 3 — Invoice chain (NULL self-refs first)
      // -----------------------------------------------------------------------
      await tx.invoice.updateMany({
        where: {
          tenantId: { in: demoUserIds },
          OR: [{ parentInvoice: { not: null } }, { convertedFromId: { not: null } }],
        },
        data: { parentInvoice: null, convertedFromId: null, convertedAt: null },
      });
      track(
        'InvoicePayment',
        await tx.invoicePayment.deleteMany({ where: { invoice: { tenantId: { in: demoUserIds } } } }),
      );
      track('CreditNote', await tx.creditNote.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('DeliveryChallan', await tx.deliveryChallan.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Quotation', await tx.quotation.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Invoice', await tx.invoice.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 4 — Expense chain (children before parents)
      // -----------------------------------------------------------------------
      track(
        'ExpenseChangeLog',
        await tx.expenseChangeLog.deleteMany({ where: { expense: { tenantId: { in: demoUserIds } } } }),
      );
      // child expenses first (parentExpense != null)
      track(
        'Expense (children)',
        await tx.expense.deleteMany({ where: { tenantId: { in: demoUserIds }, parentExpense: { not: null } } }),
      );
      track('Expense (parents)', await tx.expense.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 5 — Purchase chain
      // -----------------------------------------------------------------------
      track(
        'SupplierPayment',
        await tx.supplierPayment.deleteMany({ where: { purchase: { tenantId: { in: demoUserIds } } } }),
      );
      track('DebitNote', await tx.debitNote.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Purchase', await tx.purchase.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('PurchaseOrder', await tx.purchaseOrder.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 6 — Bank + petty cash
      // -----------------------------------------------------------------------
      track(
        'BankTransaction',
        await tx.bankTransaction.deleteMany({ where: { bankAccount: { tenantId: { in: demoUserIds } } } }),
      );
      track('BankDetail', await tx.bankDetail.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track(
        'PettyCashTransaction',
        await tx.pettyCashTransaction.deleteMany({ where: { remarks: { startsWith: 'DEMO-PC' } } }),
      );
      // PettyCash rows left orphaned after demo txn deletion
      track('PettyCash', await tx.pettyCash.deleteMany({ where: { transactions: { none: {} } } }));

      // -----------------------------------------------------------------------
      // Step 7 — Payroll (Phase 2). PayRunLine→PayRun is onDelete:Cascade and
      // PayRunLine→User(employeeUserId) is RESTRICT, so lines must go before the
      // demo users (Step 12). Reached via untyped delegate (stale-client safe).
      // -----------------------------------------------------------------------
      const ptx = tx as unknown as Record<string, { deleteMany: (a: unknown) => Promise<Prisma.BatchPayload> }>;
      track('PayRunLine', await ptx['payRunLine']!.deleteMany({ where: { payRun: { tenantId: { in: demoUserIds } } } }));
      track('PayRun', await ptx['payRun']!.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('PayrollProfile', await ptx['payrollProfile']!.deleteMany({ where: { tenantId: { in: demoUserIds } } }));


      // -----------------------------------------------------------------------
      // Step 8 — Journal / ledger / accounts
      // JournalLine cascades with JournalEntry, so deleting JournalEntry auto-removes lines.
      // We delete explicitly first so the counts are accurate.
      // -----------------------------------------------------------------------
      const journalEntryIds = (
        await tx.journalEntry.findMany({ where: { tenantId: { in: demoUserIds } }, select: { id: true } })
      ).map((e) => e.id);
      if (journalEntryIds.length) {
        track(
          'JournalLine',
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: journalEntryIds } } }),
        );
      }
      // JournalEntry has a self-ref (reversedById). NULL it first.
      await tx.journalEntry.updateMany({
        where: { tenantId: { in: demoUserIds }, reversedById: { not: null } },
        data: { reversedById: null },
      });
      track('JournalEntry', await tx.journalEntry.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('LedgerAccountMapping', await tx.ledgerAccountMapping.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      // TransactionCategory references Account; delete before Account
      track('TransactionCategory', await tx.transactionCategory.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      // Budget references Account; delete before Account
      track('Budget', await tx.budget.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      // Account children (parentId != null) before parents
      track(
        'Account (children)',
        await tx.account.deleteMany({ where: { tenantId: { in: demoUserIds }, parentId: { not: null } } }),
      );
      track('Account (parents)', await tx.account.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('AccountingPeriod', await tx.accountingPeriod.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('FixedAsset', await tx.fixedAsset.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('ExchangeRate', await tx.exchangeRate.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('CostCenter', await tx.costCenter.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Project', await tx.project.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 9 — Inventory + Products + TaxRate + ExpenseCategory
      // -----------------------------------------------------------------------
      // Inventory referencing DEMO- products (possibly owned by other users from test runs)
      track(
        'Inventory (demo-product)',
        await tx.inventory.deleteMany({ where: { product: { code: { startsWith: 'DEMO-' } } } }),
      );
      // Inventory owned by demo users (any product)
      track(
        'Inventory (demo-user)',
        await tx.inventory.deleteMany({ where: { tenantId: { in: demoUserIds } } }),
      );
      track('Product (DEMO-)', await tx.product.deleteMany({ where: { tenantId: { in: demoUserIds }, code: { startsWith: 'DEMO-' } } }));
      track('TaxRate', await tx.taxRate.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('ExpenseCategory (Demo )', await tx.expenseCategory.deleteMany({ where: { tenantId: { in: demoUserIds }, title: { startsWith: 'Demo ' } } }));

      // -----------------------------------------------------------------------
      // Step 10 — Vehicles + Reminders + Customers + Suppliers
      // -----------------------------------------------------------------------
      track('Vehicle', await tx.vehicle.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Reminder', await tx.reminder.deleteMany({ where: { createdBy: { in: demoUserIds } } }));
      track('Customer', await tx.customer.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Supplier', await tx.supplier.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 11 — Config models + AccountingIntegration + Localization + CompanySettings
      // -----------------------------------------------------------------------
      track('GatewayConfig', await tx.gatewayConfig.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('MessagingConfig', await tx.messagingConfig.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('AiConfig', await tx.aiConfig.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('AccountingIntegration', await tx.accountingIntegration.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('Localization', await tx.localization.deleteMany({ where: { tenantId: { in: demoUserIds } } }));
      track('CompanySettings', await tx.companySettings.deleteMany({ where: { tenantId: { in: demoUserIds } } }));

      // -----------------------------------------------------------------------
      // Step 12 — Users (last — owner must be deleted after staff)
      // -----------------------------------------------------------------------
      if (staffUsers.length) {
        track(
          'User (staff)',
          await tx.user.deleteMany({ where: { ownerId: demoOwner.id } }),
        );
      }
      track('User (owner)', await tx.user.deleteMany({ where: { id: demoOwner.id } }));
    },
    {
      // Large data sets with many FK checks may need more time
      timeout: 120_000,
    },
  );

  const tablesDeleted = Object.values(deletedCounts).filter((c) => c > 0).length;
  console.log(`\nPurge complete: ${totalDeleted} rows across ${tablesDeleted} tables deleted. Demo tenant removed; baseline intact.`);
}

// ---------------------------------------------------------------------------
// Skipped models (not in schema or not demo-scoped — left intentionally):
//   - InvoiceTemplate        : tenantId FK exists but no demo data seeded; skipped
//   - InventoryCostLayer      : tenantId plain scalar, no Prisma relation; no demo data
//   - Signature               : tenantId FK exists but no demo data seeded; skipped
//   - Conversation            : tenantId FK exists but no demo data seeded; skipped
//   - AIChatSession (legacy)  : older model (line 1923); no demo data; skipped
//   - AIConfiguration (legacy): older model; no demo data; skipped
//   - AIPromptLog (legacy)    : older model; no demo data; skipped
//   - AIPromptTemplate (legacy): older model; no demo data; skipped
//   - LoginActivity           : intentionally NOT deleted (audit trail)
//   - AuditLog                : intentionally NOT deleted (audit trail)
//   - Role / Permission / Module / Country / State / City / Timezone
//     / Currency / DateFormat / TimeFormat / GeneralSetting / EmailTemplate
//     / NotificationType / NotificationTag / FieldType / CustomFieldDataType
//     / Brand / Category / Unit / TaxGroup / PaymentMode / EmailSettings
//     : NEVER touched — baseline/global data
// ---------------------------------------------------------------------------

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err: unknown) => {
    console.error('Fatal error during purge:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
