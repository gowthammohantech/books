const Invoice = require("@models/Invoice");
const PurchaseOrder = require("@models/PurchaseOrder");
const Quotation = require("@models/Quotation");
const Expense = require("@models/Expense");

/**
 * Check for potential duplicate documents
 * @param {string} documentType - Type of document to check
 * @param {object} payload - The document data to check against
 * @param {string} userId - The user's ID
 * @returns {object} Duplicate detection result
 */
async function checkDuplicates(documentType, payload, userId) {
  const duplicates = [];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const amountTolerance = 0.05; // 5% tolerance for amount matching

  switch (documentType) {
    case "invoice": {
      const amount = payload.TotalAmount || 0;
      const minAmount = amount * (1 - amountTolerance);
      const maxAmount = amount * (1 + amountTolerance);

      const query = {
        userId,
        isDeleted: false,
        createdAt: { $gte: thirtyDaysAgo },
      };

      // Check by customer + similar amount
      if (payload.customerId || payload.billTo) {
        query.$or = [
          { customerId: payload.customerId || payload.billTo },
          { billTo: payload.customerId || payload.billTo },
        ];
        query.TotalAmount = { $gte: minAmount, $lte: maxAmount };
      }

      const matches = await Invoice.find(query)
        .select("invoiceNumber TotalAmount status invoiceDate customerId")
        .populate("customerId", "name")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      for (const match of matches) {
        duplicates.push({
          type: "Invoice",
          id: match._id,
          number: match.invoiceNumber,
          amount: match.TotalAmount,
          status: match.status,
          date: match.invoiceDate,
          customer: match.customerId?.name || "Unknown",
          similarity: calculateSimilarity(amount, match.TotalAmount),
        });
      }
      break;
    }

    case "purchase_order": {
      const amount = payload.TotalAmount || 0;
      const minAmount = amount * (1 - amountTolerance);
      const maxAmount = amount * (1 + amountTolerance);

      const query = {
        userId,
        isDeleted: false,
        createdAt: { $gte: thirtyDaysAgo },
        TotalAmount: { $gte: minAmount, $lte: maxAmount },
      };

      if (payload.vendorId || payload.billTo) {
        query.billTo = payload.vendorId || payload.billTo;
      }

      const matches = await PurchaseOrder.find(query)
        .select("purchaseOrderId TotalAmount status purchaseOrderDate")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      for (const match of matches) {
        duplicates.push({
          type: "PurchaseOrder",
          id: match._id,
          number: match.purchaseOrderId,
          amount: match.TotalAmount,
          status: match.status,
          date: match.purchaseOrderDate,
          similarity: calculateSimilarity(amount, match.TotalAmount),
        });
      }
      break;
    }

    case "quotation": {
      const amount = payload.TotalAmount || 0;
      const minAmount = amount * (1 - amountTolerance);
      const maxAmount = amount * (1 + amountTolerance);

      const query = {
        userId,
        isDeleted: false,
        createdAt: { $gte: thirtyDaysAgo },
        TotalAmount: { $gte: minAmount, $lte: maxAmount },
      };

      if (payload.customerId || payload.billTo) {
        query.billTo = payload.customerId || payload.billTo;
      }

      const matches = await Quotation.find(query)
        .select("quotationId TotalAmount status quotationDate")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      for (const match of matches) {
        duplicates.push({
          type: "Quotation",
          id: match._id,
          number: match.quotationId,
          amount: match.TotalAmount,
          status: match.status,
          date: match.quotationDate,
          similarity: calculateSimilarity(amount, match.TotalAmount),
        });
      }
      break;
    }

    case "expense": {
      const amount = payload.amount || 0;
      const minAmount = amount * (1 - amountTolerance);
      const maxAmount = amount * (1 + amountTolerance);

      const query = {
        userId,
        isDeleted: false,
        createdAt: { $gte: thirtyDaysAgo },
        amount: { $gte: minAmount, $lte: maxAmount },
      };

      if (payload.expenseCategoryId) {
        query.expenseCategoryId = payload.expenseCategoryId;
      }

      const matches = await Expense.find(query)
        .select("expenseId amount paymentStatus expenseDate description")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      for (const match of matches) {
        duplicates.push({
          type: "Expense",
          id: match._id,
          number: match.expenseId,
          amount: match.amount,
          status: match.paymentStatus,
          date: match.expenseDate,
          description: match.description,
          similarity: calculateSimilarity(amount, match.amount),
        });
      }
      break;
    }
  }

  return {
    hasDuplicates: duplicates.length > 0,
    duplicates,
  };
}

function calculateSimilarity(amount1, amount2) {
  if (amount1 === 0 && amount2 === 0) return 1;
  if (amount1 === 0 || amount2 === 0) return 0;
  const diff = Math.abs(amount1 - amount2);
  const avg = (amount1 + amount2) / 2;
  return Math.round((1 - diff / avg) * 100) / 100;
}

module.exports = { checkDuplicates };
