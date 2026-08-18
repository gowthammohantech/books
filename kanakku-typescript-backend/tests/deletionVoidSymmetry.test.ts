/**
 * tests/deletionVoidSymmetry.test.ts
 *
 * P1 Task 1 — deletion/void symmetry. Every delete path must reverse the SAME
 * effects the corresponding void applies: the payment JEs get reversed, the
 * bank / petty-cash balance is restored to its pre-document value, a reversing
 * bank/petty txn is written, the payment rows are marked voided (or the parent
 * status recomputed), and restocked inventory is un-restocked.
 *
 * These are control-flow assertions over a mocked Prisma tx (the repo's
 * established controller-spec pattern) — the GL engine is mocked, so we assert
 * that the exact reversal calls happen, not real double-entry netting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

const TENANT_ID = 'tenant-alpha';

const {
  mockReverseDocument,
  mockVoidDocument,
  mockApplyStockAdjustment,
  // shared model mocks (used on BOTH prisma root and the tx object)
  m,
} = vi.hoisted(() => {
  const mk = () => vi.fn();
  return {
    mockReverseDocument: vi.fn().mockResolvedValue(undefined),
    mockVoidDocument: vi.fn().mockResolvedValue(undefined),
    mockApplyStockAdjustment: vi.fn().mockResolvedValue(undefined),
    m: {
      invoiceFindFirst: mk(),
      invoiceUpdate: mk(),
      invoicePaymentFindMany: mk(),
      invoicePaymentUpdate: mk(),
      purchaseFindFirst: mk(),
      purchaseUpdate: mk(),
      supplierPaymentFindFirst: mk(),
      supplierPaymentFindMany: mk(),
      supplierPaymentUpdate: mk(),
      supplierPaymentDelete: mk(),
      supplierPaymentAggregate: mk(),
      expenseFindFirst: mk(),
      expenseUpdate: mk(),
      creditNoteFindFirst: mk(),
      creditNoteDelete: mk(),
      bankDetailFindFirst: mk(),
      bankDetailUpdate: mk(),
      bankTransactionFindFirst: mk(),
      bankTransactionCreate: mk(),
      bankTransactionUpdate: mk(),
      pettyCashFindFirst: mk(),
      pettyCashUpdate: mk(),
      pettyCashTransactionCreate: mk(),
      pettyCashTransactionFindFirst: mk(),
      productFindUnique: mk(),
      inventoryFindFirst: mk(),
      paymentModeFindUnique: mk(),
      accountCreditEntryUpdateMany: mk(),
    },
  };
});

vi.mock('../lib/prisma', () => {
  const tx = {
    invoice: { findFirst: m.invoiceFindFirst, update: m.invoiceUpdate },
    invoicePayment: { findMany: m.invoicePaymentFindMany, update: m.invoicePaymentUpdate },
    accountCreditEntry: { updateMany: m.accountCreditEntryUpdateMany },
    purchase: { findFirst: m.purchaseFindFirst, update: m.purchaseUpdate },
    supplierPayment: {
      findFirst: m.supplierPaymentFindFirst,
      findMany: m.supplierPaymentFindMany,
      update: m.supplierPaymentUpdate,
      delete: m.supplierPaymentDelete,
      aggregate: m.supplierPaymentAggregate,
    },
    expense: { findFirst: m.expenseFindFirst, update: m.expenseUpdate },
    creditNote: { findFirst: m.creditNoteFindFirst, delete: m.creditNoteDelete },
    bankDetail: { findFirst: m.bankDetailFindFirst, findUnique: m.bankDetailFindFirst, update: m.bankDetailUpdate },
    bankTransaction: { create: m.bankTransactionCreate, update: m.bankTransactionUpdate, findFirst: m.bankTransactionFindFirst },
    pettyCash: { findFirst: m.pettyCashFindFirst, update: m.pettyCashUpdate },
    pettyCashTransaction: { create: m.pettyCashTransactionCreate, findFirst: m.pettyCashTransactionFindFirst },
    product: { findUnique: m.productFindUnique },
    inventory: { findFirst: m.inventoryFindFirst },
    paymentMode: { findUnique: m.paymentModeFindUnique },
  };
  return {
    prisma: {
      invoice: { findFirst: m.invoiceFindFirst },
      purchase: { findFirst: m.purchaseFindFirst },
      supplierPayment: { findFirst: m.supplierPaymentFindFirst },
      expense: { findFirst: m.expenseFindFirst },
      creditNote: { findFirst: m.creditNoteFindFirst },
      bankTransaction: { findFirst: m.bankTransactionFindFirst },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  reverseDocument: mockReverseDocument,
  voidDocument: mockVoidDocument,
}));
vi.mock('../lib/inventory/stockAdjust', () => ({ applyStockAdjustment: mockApplyStockAdjustment, resolveRestockUnitCost: vi.fn().mockResolvedValue(0) }));

import { deleteInvoice } from '../controllers/Admin/Invoice/invoiceController';
import { deletePurchase } from '../controllers/Admin/Purchases/purchaseController';
import { deleteSupplierPayment } from '../controllers/Admin/Purchases/supplierPaymentController';
import { deleteExpense } from '../controllers/expenseController';
import { deleteCreditNote } from '../controllers/Admin/Invoice/creditNoteController';
import { remove as removeBankTransaction } from '../controllers/bankTransactionController';

function makeReqRes(params: Record<string, unknown> = {}) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, params, body: {}, query: {} } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  return { req, res };
}

const num = (v: unknown) => Number(v as never);
/** Find the mock call whose first arg's `where.id` (or data) matches a predicate. */
function dataOf(mock: ReturnType<typeof vi.fn>, idx = 0) {
  return (mock.mock.calls[idx]?.[0] as { data?: Record<string, unknown> })?.data ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReverseDocument.mockResolvedValue(undefined);
  mockVoidDocument.mockResolvedValue(undefined);
  mockApplyStockAdjustment.mockResolvedValue(undefined);
  Object.values(m).forEach((fn) => fn.mockReset());
  // sensible defaults
  m.invoiceUpdate.mockResolvedValue({});
  m.invoicePaymentFindMany.mockResolvedValue([]);
  m.invoicePaymentUpdate.mockResolvedValue({});
  m.purchaseUpdate.mockResolvedValue({});
  m.supplierPaymentFindMany.mockResolvedValue([]);
  m.supplierPaymentUpdate.mockResolvedValue({});
  m.supplierPaymentDelete.mockResolvedValue({});
  m.supplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });
  m.expenseUpdate.mockResolvedValue({});
  m.creditNoteDelete.mockResolvedValue({});
  m.bankDetailFindFirst.mockResolvedValue(null);
  m.bankDetailUpdate.mockResolvedValue({});
  m.bankTransactionCreate.mockResolvedValue({});
  m.bankTransactionUpdate.mockResolvedValue({});
  // Finding-1 discriminator: these delete tests exercise RECORD-PATH payments
  // (recorded via recordInvoicePayment/createSupplierPayment), which authored
  // their own cash line — so the reversal SHOULD move the register. Default the
  // discriminator lookups to a truthy self-authored row.
  m.bankTransactionFindFirst.mockResolvedValue({ id: 'bt-self' });
  m.pettyCashTransactionFindFirst.mockResolvedValue({ id: 'pct-self' });
  m.pettyCashFindFirst.mockResolvedValue(null);
  m.pettyCashUpdate.mockResolvedValue({});
  m.pettyCashTransactionCreate.mockResolvedValue({});
  m.productFindUnique.mockResolvedValue({ item_type: 'Product' });
  m.inventoryFindFirst.mockResolvedValue({ avgCost: new Prisma.Decimal(10) });
  m.paymentModeFindUnique.mockResolvedValue({ slug: 'bank_transfer' });
  m.accountCreditEntryUpdateMany.mockResolvedValue({ count: 0 });
});

// ===========================================================================
// 1. deleteInvoice — voids its payments (bank balance restored, JE reversed)
// ===========================================================================
describe('deleteInvoice reverses recorded payments', () => {
  it('reverses the payment JE, decrements bank, writes reversing txn, marks payment voided', async () => {
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-1', userId: TENANT_ID, isDeleted: false, invoiceType: 'INVOICE',
      invoiceNumber: 'INV-1', items: [{ productId: 'prod-1', qty: 2, unit: 'u1' }],
    });
    m.invoicePaymentFindMany.mockResolvedValue([
      { id: 'pay-1', amount: 100, paymentModeId: 'pm-1', bank: { id: 'bank-1', currentBalance: 300 }, paymentMode: { slug: 'bank_transfer' }, movedBankBalance: true },
    ]);

    const { req, res } = makeReqRes({ id: 'inv-1' });
    await deleteInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // payment JE reversed on the exact triple
    expect(mockReverseDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'InvoicePayment', sourceId: 'pay-1', event: 'payment' }));
    // bank decremented 300 -> 200
    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(200);
    // reversing bank txn is money-OUT
    expect(dataOf(m.bankTransactionCreate).type).toBe('TRANSFER_OUT');
    // reversing bank txn is EXPLAINED so it doesn't clutter the Unexplained queue
    expect(dataOf(m.bankTransactionCreate).explainStatus).toBe('EXPLAINED');
    // payment marked voided
    expect(dataOf(m.invoicePaymentUpdate).isVoided).toBe(true);
    // stock restored + invoice soft-deleted
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'stock_in', qtyDelta: 2 }));
    expect(dataOf(m.invoiceUpdate).isDeleted).toBe(true);
  });

  it('does NOT reverse an already-voided payment', async () => {
    m.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', userId: TENANT_ID, isDeleted: false, invoiceType: 'PROFORMA', items: [] });
    m.invoicePaymentFindMany.mockResolvedValue([]); // findMany filters isVoided:false → none
    const { req, res } = makeReqRes({ id: 'inv-1' });
    await deleteInvoice(req, res);
    expect(m.invoicePaymentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isVoided: false }) }));
    expect(m.bankDetailUpdate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. deletePurchase — voids its supplier payments (bank restored)
// ===========================================================================
describe('deletePurchase reverses supplier payments', () => {
  it('reverses the payment JE, increments bank, writes reversing txn, marks payment voided', async () => {
    m.purchaseFindFirst.mockResolvedValue({ id: 'pur-1', userId: TENANT_ID, isDeleted: false, status: 'received', purchaseId: 'PUR-1', items: [{ productId: 'prod-1', qty: 3, unit: 'u1' }] });
    m.supplierPaymentFindMany.mockResolvedValue([
      { id: 'sp-1', paidAmount: 100, paymentModeId: 'pm-1', sourceType: 'BANK', bank: { id: 'bank-1', currentBalance: 50 }, movedBankBalance: true },
    ]);

    const { req, res } = makeReqRes({ id: 'pur-1' });
    await deletePurchase(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReverseDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'SupplierPayment', sourceId: 'sp-1', event: 'payment' }));
    // bank incremented 50 -> 150 (refund of outflow)
    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(150);
    expect(dataOf(m.bankTransactionCreate).type).toBe('TRANSFER_IN');
    expect(dataOf(m.supplierPaymentUpdate).isVoided).toBe(true);
    // stock reverted + purchase soft-deleted
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'stock_out', qtyDelta: -3 }));
    expect(dataOf(m.purchaseUpdate).isDeleted).toBe(true);
  });
});

// ===========================================================================
// 3. deleteSupplierPayment — restore balance, correct status (not forced partial)
// ===========================================================================
describe('deleteSupplierPayment restores balance and recomputes status', () => {
  it('increments bank, writes reversing txn, and recomputes purchase to pending when nothing remains', async () => {
    m.supplierPaymentFindFirst
      .mockResolvedValueOnce({ id: 'sp-1', purchaseId: 'pur-1' }) // outer scope check
      .mockResolvedValueOnce({ id: 'sp-1', purchaseId: 'pur-1', paidAmount: 100, paymentModeId: 'pm-1', sourceType: 'BANK', bank: { id: 'bank-1', currentBalance: 50 }, movedBankBalance: true, purchase: { id: 'pur-1', totalAmount: 200 } });
    m.supplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    const { req, res } = makeReqRes({ id: 'sp-1' });
    await deleteSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReverseDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'SupplierPayment', sourceId: 'sp-1', event: 'payment' }));
    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(150);
    expect(dataOf(m.bankTransactionCreate).type).toBe('TRANSFER_IN');
    expect(m.supplierPaymentDelete).toHaveBeenCalledWith({ where: { id: 'sp-1' } });
    // NOT forced partially_paid — 0 remaining => pending, paidAmount 0, balance 200
    const pd = dataOf(m.purchaseUpdate);
    expect(pd.status).toBe('pending');
    expect(num(pd.paidAmount)).toBe(0);
    expect(num(pd.balanceAmount)).toBe(200);
  });

  it('restores petty cash for a PETTY_CASH payment', async () => {
    m.supplierPaymentFindFirst
      .mockResolvedValueOnce({ id: 'sp-2', purchaseId: 'pur-1' })
      .mockResolvedValueOnce({ id: 'sp-2', purchaseId: 'pur-1', paidAmount: 40, paymentModeId: null, sourceType: 'PETTY_CASH', bank: null, movedBankBalance: true, purchase: { id: 'pur-1', totalAmount: 200 } });
    m.pettyCashFindFirst.mockResolvedValue({ id: 'pc-1', currentBalance: 60 });
    m.supplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    const { req, res } = makeReqRes({ id: 'sp-2' });
    await deleteSupplierPayment(req, res);

    expect(num(dataOf(m.pettyCashUpdate).currentBalance)).toBe(100);
    expect(dataOf(m.pettyCashTransactionCreate).transactionType).toBe('RETURN');
  });
});

// ===========================================================================
// 4. deleteExpense — refund bank / petty
// ===========================================================================
describe('deleteExpense refunds the cash source', () => {
  it('refunds a BANK expense: increments bank + writes reversing money-in txn', async () => {
    m.expenseFindFirst.mockResolvedValue({ id: 'exp-1', userId: TENANT_ID, isDeleted: false, sourceType: 'BANK', bankId: 'bank-1', paymentModeId: 'pm-1', amount: '50.00', expenseId: 'EXP-1' });
    m.bankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 200 });
    m.paymentModeFindUnique.mockResolvedValue({ slug: 'bank_transfer' });

    const { req, res } = makeReqRes({ id: 'exp-1' });
    await deleteExpense(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReverseDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'Expense', event: 'recorded' }));
    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(250);
    expect(dataOf(m.bankTransactionCreate).type).toBe('TRANSFER_IN');
    expect(dataOf(m.expenseUpdate).isDeleted).toBe(true);
  });

  it('refunds a PETTY_CASH expense: increments petty + RETURN txn', async () => {
    m.expenseFindFirst.mockResolvedValue({ id: 'exp-2', userId: TENANT_ID, isDeleted: false, sourceType: 'PETTY_CASH', bankId: null, paymentModeId: null, amount: '30.00', expenseId: 'EXP-2' });
    m.pettyCashFindFirst.mockResolvedValue({ id: 'pc-1', currentBalance: 70 });

    const { req, res } = makeReqRes({ id: 'exp-2' });
    await deleteExpense(req, res);

    expect(num(dataOf(m.pettyCashUpdate).currentBalance)).toBe(100);
    expect(dataOf(m.pettyCashTransactionCreate).transactionType).toBe('RETURN');
  });

  it('EMPLOYEE_PAID expense touches no bank/petty balance', async () => {
    m.expenseFindFirst.mockResolvedValue({ id: 'exp-3', userId: TENANT_ID, isDeleted: false, sourceType: 'EMPLOYEE_PAID', bankId: null, paymentModeId: null, amount: '20.00', expenseId: 'EXP-3' });
    const { req, res } = makeReqRes({ id: 'exp-3' });
    await deleteExpense(req, res);
    expect(m.bankDetailUpdate).not.toHaveBeenCalled();
    expect(m.pettyCashUpdate).not.toHaveBeenCalled();
    expect(dataOf(m.expenseUpdate).isDeleted).toBe(true);
  });
});

// ===========================================================================
// 5. deleteCreditNote — reverse the restock
// ===========================================================================
describe('deleteCreditNote reverses the restock', () => {
  it('stock_outs the previously restocked qty for stockable items', async () => {
    m.creditNoteFindFirst.mockResolvedValue({ id: 'cn-1', userId: TENANT_ID, items: [{ id: 'prod-1', qty: 2 }] });
    m.productFindUnique.mockResolvedValue({ item_type: 'Product' });
    m.inventoryFindFirst.mockResolvedValue({ avgCost: new Prisma.Decimal(12) });

    const { req, res } = makeReqRes({ id: 'cn-1' });
    await deleteCreditNote(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReverseDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'CreditNote', event: 'issued' }));
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'stock_out', qtyDelta: -2, referenceType: 'sales_return', unitCost: 12 }));
    expect(m.creditNoteDelete).toHaveBeenCalledWith({ where: { id: 'cn-1' } });
  });

  it('skips Service items (nothing was restocked)', async () => {
    m.creditNoteFindFirst.mockResolvedValue({ id: 'cn-2', userId: TENANT_ID, items: [{ id: 'svc-1', qty: 5 }] });
    m.productFindUnique.mockResolvedValue({ item_type: 'Service' });
    const { req, res } = makeReqRes({ id: 'cn-2' });
    await deleteCreditNote(req, res);
    expect(mockApplyStockAdjustment).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 6. bankTransaction remove — adjust currentBalance by the inverse
// ===========================================================================
describe('bankTransaction remove undoes its balance effect', () => {
  it('adds back a money-out txn amount on removal', async () => {
    m.bankTransactionFindFirst.mockResolvedValue({ id: 'bt-1', bankAccountId: 'bank-1', balanceBefore: new Prisma.Decimal(300), balanceAfter: new Prisma.Decimal(200) });
    m.bankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: new Prisma.Decimal(200) });

    const { req, res } = makeReqRes({ id: 'bt-1' });
    await removeBankTransaction(req, res);

    // applied delta was -100 → removal adds it back: 200 - (-100) = 300
    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(300);
    expect(dataOf(m.bankTransactionUpdate).isDeleted).toBe(true);
  });

  it('subtracts a money-in txn amount on removal', async () => {
    m.bankTransactionFindFirst.mockResolvedValue({ id: 'bt-2', bankAccountId: 'bank-1', balanceBefore: new Prisma.Decimal(100), balanceAfter: new Prisma.Decimal(180) });
    m.bankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: new Prisma.Decimal(180) });

    const { req, res } = makeReqRes({ id: 'bt-2' });
    await removeBankTransaction(req, res);

    // applied delta was +80 → removal subtracts it: 180 - 80 = 100
    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(100);
  });

  it('adjusts currentBalance for a MANUAL txn (relatedType explicitly MANUAL)', async () => {
    m.bankTransactionFindFirst.mockResolvedValue({
      id: 'bt-3', bankAccountId: 'bank-1', relatedType: 'MANUAL', relatedId: null,
      balanceBefore: new Prisma.Decimal(300), balanceAfter: new Prisma.Decimal(200),
    });
    m.bankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: new Prisma.Decimal(200) });

    const { req, res } = makeReqRes({ id: 'bt-3' });
    await removeBankTransaction(req, res);

    expect(num(dataOf(m.bankDetailUpdate).currentBalance)).toBe(300);
    expect(dataOf(m.bankTransactionUpdate).isDeleted).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // -------------------------------------------------------------------------
  // 6b. bankTransaction remove — document-linked lines must NOT double-reverse
  // -------------------------------------------------------------------------
  it.each([
    ['INVOICE_PAYMENT', 'ip-1'],
    ['SUPPLIER_PAYMENT', 'sp-1'],
    ['EXPENSE', 'exp-1'],
    ['PETTYCASH', 'pc-1'],
  ])('rejects removal of a %s-linked bank txn (parent void owns the reversal)', async (relatedType, relatedId) => {
    m.bankTransactionFindFirst.mockResolvedValue({
      id: 'bt-doc', bankAccountId: 'bank-1', relatedType, relatedId,
      balanceBefore: new Prisma.Decimal(300), balanceAfter: new Prisma.Decimal(200),
    });

    const { req, res } = makeReqRes({ id: 'bt-doc' });
    await removeBankTransaction(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(m.bankDetailUpdate).not.toHaveBeenCalled();
    expect(m.bankTransactionUpdate).not.toHaveBeenCalled();
  });
});
