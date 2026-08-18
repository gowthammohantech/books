const dayjs = require("dayjs");

/**
 * Format AI-resolved data into the schema expected by existing Kannaku controllers
 * @param {string} documentType - The document type to format for
 * @param {object} resolvedData - Entity-resolved data from the AI
 * @param {object} userContext - User info (userId, billFrom, etc.)
 * @returns {object} Formatted payload ready for the existing controller
 */
function formatForController(documentType, resolvedData, userContext) {
  switch (documentType) {
    case "invoice":
      return formatInvoice(resolvedData, userContext);
    case "purchase_order":
      return formatPurchaseOrder(resolvedData, userContext);
    case "quotation":
      return formatQuotation(resolvedData, userContext);
    case "expense":
      return formatExpense(resolvedData, userContext);
    default:
      throw new Error(`Unsupported document type: ${documentType}`);
  }
}

function formatInvoice(data, userContext) {
  const items = formatItems(data.items, data.tax);
  const { taxableAmount, vat, totalDiscount, TotalAmount } =
    calculateTotals(items, data.tax);

  const dueDate = data.dueDate
    ? new Date(data.dueDate)
    : data.paymentTermsDays != null
      ? dayjs().add(data.paymentTermsDays, "day").toDate()
      : dayjs().add(15, "day").toDate();

  const payload = {
    customerId: data.customerId || userContext.userId,
    invoiceDate: new Date(),
    dueDate,
    referenceNo: "",
    items,
    status: "DRAFT",
    taxableAmount,
    vat,
    totalDiscount,
    TotalAmount,
    roundOff: false,
    notes: data.notes || "",
    termsAndCondition: "",
    sign_type: "none",
    userId: userContext.userId,
    billFrom: userContext.userId,
    billTo: data.customerId || userContext.userId,
    isRecurring: data.recurring?.enabled || false,
    repeatEvery: data.recurring?.interval || "month",
  };

  if (data.recurring?.enabled) {
    payload.startOn = new Date();
    payload.neverExpire = true;
  }

  return payload;
}

function formatPurchaseOrder(data, userContext) {
  const items = formatItems(data.items, data.tax);
  const { taxableAmount, vat, totalDiscount, TotalAmount } =
    calculateTotals(items, data.tax);

  const dueDate = data.dueDate
    ? new Date(data.dueDate)
    : data.paymentTermsDays != null
      ? dayjs().add(data.paymentTermsDays, "day").toDate()
      : dayjs().add(30, "day").toDate();

  return {
    vendorId: data.vendorId || userContext.userId,
    purchaseOrderDate: new Date(),
    dueDate,
    referenceNo: "",
    items,
    status: "new",
    taxableAmount,
    vat,
    totalDiscount,
    TotalAmount,
    roundOff: false,
    notes: data.notes || "",
    termsAndCondition: "",
    sign_type: "none",
    userId: userContext.userId,
    billFrom: userContext.userId,
    billTo: data.vendorId || userContext.userId,
  };
}

function formatQuotation(data, userContext) {
  const items = formatItems(data.items, data.tax);
  const { taxableAmount, vat, totalDiscount, TotalAmount } =
    calculateTotals(items, data.tax);

  const expiryDate = data.dueDate
    ? new Date(data.dueDate)
    : data.paymentTermsDays != null
      ? dayjs().add(data.paymentTermsDays, "day").toDate()
      : dayjs().add(30, "day").toDate();

  return {
    customerId: data.customerId || userContext.userId,
    quotationDate: new Date(),
    expiryDate,
    referenceNo: "",
    items,
    status: "draft",
    taxableAmount,
    vat,
    totalDiscount,
    TotalAmount,
    roundOff: false,
    notes: data.notes || "",
    termsAndCondition: "",
    sign_type: "none",
    userId: userContext.userId,
    billFrom: userContext.userId,
    billTo: data.customerId || userContext.userId,
  };
}

function formatExpense(data, userContext) {
  // const totalAmount =
  //   data.items?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0;

  // const amount =
  //   (typeof data.expenseAmount === "number" && data.expenseAmount > 0)
  //     ? data.expenseAmount
  //     : (typeof data.amount === "number" && data.amount > 0)
  //       ? data.amount
  //       : (data.items?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0);

  const parseAmount = (val) => {
    if (typeof val === "number" && val > 0) return val;
    if (typeof val === "string") {
      const cleaned = parseFloat(val.replace(/,/g, ""));
      if (!isNaN(cleaned) && cleaned > 0) return cleaned;
    }
    return 0;
  };

  const amount =
    parseAmount(data.expenseAmount) ||
    parseAmount(data.amount) ||
    (data.items?.reduce((sum, item) => sum + parseAmount(item.amount), 0) ?? 0);

  if (amount === 0) {
    console.warn("[formatExpense] Amount resolved to 0. Raw data:", JSON.stringify(data));
  }
  const rawSource = (data.paymentSource || "PETTY_CASH").toString().toUpperCase().trim();
  const sourceType = rawSource === "BANK" ? "BANK" : "PETTY_CASH";
  return {
    amount: amount,
    expenseDate: data.dueDate ? new Date(data.dueDate) : new Date(),
    description: data.notes || data.items?.map((i) => i.name).join(", ") || "",
    expenseCategoryId: data.expenseCategoryId || null,
    sourceType: sourceType,
    paymentStatus: data.paymentStatus || "PENDING",
    paymentMode: data.paymentMode || null,   
    bankId: data.bankId || null,        
    vendorId: data.vendorId || null,
    userId: userContext.userId,
  };
}

/**
 * Format items array with tax calculations
 */
function formatItems(items, taxInfo) {
  if (!items || items.length === 0) return [];

  return items.map((item, index) => {
    const qty = item.quantity || 1;
    const rate = item.rate || 0;
    const baseAmount = qty * rate;

    let taxAmount = 0;
    let taxGroupId = null;

    if (taxInfo && taxInfo.type !== "none" && taxInfo.rate) {
      if (taxInfo.inclusive) {
        // Tax inclusive: rate already includes tax
        taxAmount = baseAmount - baseAmount / (1 + taxInfo.rate / 100);
      } else {
        // Tax exclusive: add tax on top
        taxAmount = (baseAmount * taxInfo.rate) / 100;
      }
    }

    return {
      id: item.productId || `item-${index + 1}`,
      name: item.name || `Item ${index + 1}`,
      unit: item.unit || "",
      qty,
      rate,
      discount: 0,
      tax: Math.round(taxAmount * 100) / 100,
      tax_group_id: item.taxGroupId || taxGroupId,
      discount_type: "Fixed",
      discount_value: 0,
      amount: Math.round((baseAmount + (taxInfo?.inclusive ? 0 : taxAmount)) * 100) / 100,
    };
  });
}

/**
 * Calculate totals from formatted items
 */
function calculateTotals(items, taxInfo) {
  const taxableAmount = items.reduce(
    (sum, item) => sum + item.qty * item.rate,
    0
  );
  const vat = items.reduce((sum, item) => sum + (item.tax || 0), 0);
  const totalDiscount = items.reduce(
    (sum, item) => sum + (item.discount || 0),
    0
  );

  let TotalAmount;
  if (taxInfo?.inclusive) {
    TotalAmount = taxableAmount - totalDiscount;
  } else {
    TotalAmount = taxableAmount + vat - totalDiscount;
  }

  return {
    taxableAmount: Math.round(taxableAmount * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    TotalAmount: Math.round(TotalAmount * 100) / 100,
  };
}

module.exports = { formatForController };
