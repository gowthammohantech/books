import type { IllustrationKey } from "@utils/illustrations";

/**
 * What each list says when it has never held a record.
 *
 * Kept in one file rather than inline on ~35 pages because this is product
 * copy, and copy spread across thirty-five components cannot be read as a set
 * — you cannot tell that four lists all opened with "No records found" until
 * they are in a column next to each other.
 *
 * Two shapes, and the difference is deliberate:
 *
 *   - **`bullets`** — for the lists a workspace genuinely starts from. These
 *     are the screens where a new user is deciding whether the product does
 *     what they came for, so they get the headline and three things it does.
 *   - **`description`** — for the utility and settings lists. "No units yet"
 *     needs one sentence saying what a unit is *for*; inventing three selling
 *     points for a units master is how empty states start reading like ads.
 *
 * `cta` is the button label only. The handler stays on the page, because each
 * one differs — invoices guards on a fetched `nextInvoiceNo` before navigating,
 * the masters open a modal, and a couple are permission-gated to nothing at all.
 */
export interface ListEmptyState {
  art: IllustrationKey;
  /** The headline. Says what the page is for — not "No data found". */
  title: string;
  /** One orienting sentence. Utility lists use this instead of bullets. */
  description?: string;
  /** Three at most. More than that stops being scannable. */
  bullets?: string[];
  /** Button label. Omit where the page has no create affordance. */
  cta?: string;
}

export const LIST_EMPTY_STATES = {
  // ---- Sales -------------------------------------------------------------
  invoices: {
    art: "invoice",
    title: "Create invoices lightning fast.",
    bullets: [
      "Bill a customer and share it in seconds",
      "GST-compliant templates, ready to send",
      "Track what is paid and what is still due",
    ],
    cta: "Create your first invoice",
  },
  quotations: {
    art: "invoice",
    title: "Quote before you bill.",
    bullets: [
      "Send a priced proposal your customer can accept",
      "Convert an accepted quote straight into an invoice",
      "Keep every revision on the same record",
    ],
    cta: "Create your first quotation",
  },
  creditNotes: {
    art: "invoice",
    title: "Credit a customer without editing history.",
    bullets: [
      "Return, cancel or adjust against an existing invoice",
      "Keeps the original invoice intact for audit",
      "Offsets automatically against what the customer owes",
    ],
    cta: "Create your first credit note",
  },
  deliveryChallans: {
    art: "invoice",
    title: "Move goods before you invoice them.",
    bullets: [
      "Send stock out with a document that is not a sale",
      "Convert to an invoice once delivery is confirmed",
      "Keeps inventory and billing in step",
    ],
    cta: "Create your first delivery challan",
  },
  recurringInvoices: {
    art: "invoice",
    title: "Bill the same customer on a schedule.",
    bullets: [
      "Set it once and let each invoice raise itself",
      "Weekly, monthly or any cycle you choose",
      "Pause or stop a schedule without losing its history",
    ],
    cta: "Create your first schedule",
  },

  // ---- Purchases ---------------------------------------------------------
  purchases: {
    art: "invoice",
    title: "Record what you buy.",
    bullets: [
      "Capture supplier bills with their tax and totals",
      "Scan a bill and let the assistant fill it in",
      "See what you owe and when it falls due",
    ],
    cta: "Record your first purchase",
  },
  purchaseOrders: {
    art: "invoice",
    title: "Order before the bill arrives.",
    bullets: [
      "Tell a supplier exactly what you want and at what price",
      "Convert the order into a purchase when goods land",
      "Track what is ordered but not yet received",
    ],
    cta: "Create your first purchase order",
  },
  debitNotes: {
    art: "invoice",
    title: "Return to a supplier, on the record.",
    bullets: [
      "Raise a claim against a purchase you have already booked",
      "Leaves the original supplier bill untouched",
      "Offsets against what you owe that supplier",
    ],
    cta: "Create your first debit note",
  },
  supplierPayments: {
    art: "cash-payment",
    title: "Pay your suppliers, tracked.",
    bullets: [
      "Settle one bill or several in a single payment",
      "Part-pay and let the balance carry forward",
      "Every payment lands against the supplier's ledger",
    ],
    cta: "Record your first payment",
  },

  // ---- Masters -----------------------------------------------------------
  products: {
    art: "empty",
    title: "Everything you sell, in one place.",
    bullets: [
      "Price, tax rate and unit set once, reused everywhere",
      "Drop an item into any document without retyping it",
      "Track stock as documents move it",
    ],
    cta: "Add your first item",
  },
  contacts: {
    art: "people-search",
    title: "Your customers and suppliers.",
    bullets: [
      "One record carries billing details, GSTIN and terms",
      "See everything a party has bought or supplied",
      "Import an existing list from CSV",
    ],
    cta: "Add your first contact",
  },
  vehicles: {
    art: "empty",
    title: "No vehicles yet.",
    description:
      "Vehicles let you record which one carried a consignment on delivery challans and e-way bills.",
    cta: "Add your first vehicle",
  },
  inventory: {
    art: "empty",
    title: "No stock tracked yet.",
    description:
      "Inventory follows the items you buy and sell, so you can see what is on hand and what it cost.",
    cta: "Add your first inventory item",
  },
  brands: {
    art: "empty",
    title: "No brands yet.",
    description: "Brands group your items by who makes them, so you can filter and report by maker.",
    cta: "Add your first brand",
  },
  categories: {
    art: "folder",
    title: "No categories yet.",
    description: "Categories group items by what they are, which is what most stock reports break down by.",
    cta: "Add your first category",
  },
  units: {
    art: "empty",
    title: "No units yet.",
    description: "Units define how you measure and sell each item — pieces, kilograms, hours, boxes.",
    cta: "Add your first unit",
  },

  // ---- Accounting --------------------------------------------------------
  chartOfAccounts: {
    art: "folder",
    title: "No accounts yet.",
    description:
      "The chart of accounts is where every transaction lands. Seed the standard set and edit from there.",
    cta: "Add your first account",
  },
  journalEntries: {
    art: "folder",
    title: "No journal entries yet.",
    description:
      "Journal entries post directly to your accounts, for the adjustments no document covers.",
    cta: "Add your first journal entry",
  },
  accountingPeriods: {
    art: "checking-boxes",
    title: "No accounting periods yet.",
    description:
      "Periods let you close a month or a year, so figures already reported cannot quietly change.",
    cta: "Add your first period",
  },
  budgets: {
    art: "analysis",
    title: "No budgets yet.",
    description:
      "Set what you expect to spend or earn, then track the variance as real figures come in.",
    cta: "Create your first budget",
  },
  projects: {
    art: "folder",
    title: "No projects yet.",
    description: "Tag documents to a project to see what it earned and what it cost, on its own P&L.",
    cta: "Create your first project",
  },
  costCenters: {
    art: "analysis",
    title: "No profit centers yet.",
    description:
      "Profit centers split income and cost by branch, team or line of business, so you can report on each.",
    cta: "Create your first profit center",
  },
  fixedAssets: {
    art: "empty",
    title: "No fixed assets yet.",
    description:
      "Register what you own so depreciation is calculated and posted for you each period.",
    cta: "Add your first asset",
  },

  // ---- Money in and out --------------------------------------------------
  expenses: {
    art: "cash-payment",
    title: "Track what the business spends.",
    bullets: [
      "Log a cost against a category and a party",
      "Attach the receipt to the record",
      "Feeds straight into your P&L and tax position",
    ],
    cta: "Record your first expense",
  },
  pettyCash: {
    art: "cash-payment",
    title: "No petty cash entries yet.",
    description: "Petty cash tracks small day-to-day spending that never goes through the bank.",
    cta: "Add your first entry",
  },
  expenseCategories: {
    art: "folder",
    title: "No expense categories yet.",
    description: "Categories decide how spending is grouped in your reports and tax filings.",
    cta: "Add your first category",
  },
  bankTransactions: {
    art: "cash-payment",
    title: "Bring your bank into the books.",
    bullets: [
      "Import a statement and explain each line once",
      "Match payments to the invoices they settle",
      "Reconcile to a balance you can prove",
    ],
    cta: "Import a statement",
  },
  currencies: {
    art: "cash-payment",
    title: "No currencies yet.",
    description: "Add the currencies you trade in to bill overseas customers in what they pay you.",
    cta: "Add your first currency",
  },

  // ---- Payroll -----------------------------------------------------------
  payrollProfiles: {
    art: "people-search",
    title: "No payroll profiles yet.",
    description: "A profile holds an employee's salary, tax details and pay cycle, ready for each run.",
    cta: "Add your first profile",
  },
  holidays: {
    art: "checking-boxes",
    title: "No holidays yet.",
    description: "The holiday calendar keeps non-working days out of leave balances and timesheets.",
    cta: "Add your first holiday",
  },

  // ---- Administration ----------------------------------------------------
  users: {
    art: "people-search",
    title: "No users yet.",
    description: "Invite the people who work in this workspace and give each of them a role.",
    cta: "Add your first user",
  },
  roles: {
    art: "people-search",
    title: "No roles yet.",
    description: "A role is a set of permissions you assign to people, so access is granted once, not per user.",
    cta: "Create your first role",
  },
  signatures: {
    art: "empty",
    title: "No signatures yet.",
    description: "Saved signatures are dropped onto invoices and quotations when you send them.",
    cta: "Add your first signature",
  },
} as const satisfies Record<string, ListEmptyState>;

export type ListEmptyStateKey = keyof typeof LIST_EMPTY_STATES;
