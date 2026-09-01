import { Navigate, Route, Routes } from "react-router-dom";
import AdminDashboard from "@pages/admin/AdminDashboard";
import SalesDashboard from "@pages/admin/dashboard/SalesDashboard";
import AccountsDashboard from "@pages/admin/dashboard/AccountsDashboard";
import ExpensesDashboard from "@pages/admin/dashboard/ExpensesDashboard";
import ProtectedRoute from "./ProtectedRoute";
import AdminLayout from "@components/admin/layouts/AdminLayout";
import SettingsLayout from "@components/admin/layouts/SettingsLayout";
import AllSettings from "@pages/admin/settings/AllSettings";
import UnitList from "@pages/admin/productAndServices/UnitList";
import BrandList from "@pages/admin/productAndServices/BrandList";
import CategoryList from "@pages/admin/productAndServices/Categories";
import ProductList from "@pages/admin/productAndServices/ProductList";
import AddProduct from "@pages/admin/productAndServices/AddProduct";
import EditProduct from "@pages/admin/productAndServices/EditProduct";
import ViewProduct from "@pages/admin/productAndServices/ViewProduct";
import TaxRateList from "@pages/admin/settings/taxRates/TaxRateList";
import CreateTaxRate from "@pages/admin/settings/taxRates/CreateTaxRate";
import EditTaxRate from "@pages/admin/settings/taxRates/EditTaxRate";
import AccountSettings from "@pages/admin/settings/AccountSettings";
import SignatureList from "@pages/admin/settings/systemSettings/SignatureList";
import PurchaseOrderList from "@pages/admin/purchases/PurchaseOrderList";
import CreatePurchaseOrder from "@pages/admin/purchases/CreatePurchaseOrder";
import BankAccountList from "@pages/admin/settings/financeSettings/BankAccountList";
import LedgerSetupWizard from "@pages/admin/settings/financeSettings/LedgerSetupWizard";
import DocumentDefaultsPage from "@pages/admin/settings/financeSettings/DocumentDefaults";
import TransactionCategoriesPage from "@pages/admin/settings/financeSettings/TransactionCategories";
import CompanySettings from "@pages/admin/settings/websiteSettings/CompanySettings";
import EditPurchaseOrder from "@pages/admin/purchases/EditPurchaseOrder";
import PurchaseList from "@pages/admin/purchases/PurchaseList";
import CreatePurchase from "@pages/admin/purchases/CreatePurchase";
import SupplierPayments from "@pages/admin/purchases/SupplierPayments";
import SupplierBalances from "@pages/admin/purchases/SupplierBalances";
import DebitNoteList from "@pages/admin/purchases/DebitNoteList";
import CreateDebitNote from "@pages/admin/purchases/CreateDebitNote";
import OverviewDebitNote from "@pages/admin/purchases/OverviewDebitNote";
import CurrencyList from "@pages/admin/settings/financeSettings/currencies/CurrencyList";
import LocalizationSettings from "@pages/admin/settings/websiteSettings/LocalizationSettings";
import CustomerForm from "@pages/admin/customers/CreateCustomer";
import EditCustomer from "@pages/admin/customers/EditCustomer";
import CustomerStatement from "@pages/admin/customers/CustomerStatement";
import VehicleList from "@pages/admin/vehicles/VehicleList";
import CreateVehicle from "@pages/admin/vehicles/CreateVehicle";
import EditVehicle from "@pages/admin/vehicles/EditVehicle";
import QuotationList from "@pages/admin/quotations/QuotationList";
import CreateNewQuotation from "@pages/admin/quotations/CreateNewQuotation";
import EditQuotation from "@pages/admin/quotations/EditQuotation";
import AdminLogout from "@pages/admin/auth/AdminLogout";
import InvoiceTemplateList from "@pages/admin/invoices/InvoiceTemplateList";
import CreateInvoice from "@pages/admin/invoices/CreateInvoice";
import InvoiceList from "@pages/admin/invoices/InvoiceList";
import EditInvoice from "@pages/admin/invoices/EditInvoice";
import RecurringInvoiceList from "@pages/admin/recurring-invoices/RecurringInvoiceList";
import RecurringScheduleForm from "@pages/admin/recurring-invoices/RecurringScheduleForm";
import RecurringExpenseList from "@pages/admin/recurring-expenses/RecurringExpenseList";
import ViewInvoice from "@pages/admin/invoices/ViewInvoice";
import CreditNoteList from "@pages/admin/credit-notes/CreditNoteList";
import AddCreditNote from "@pages/admin/credit-notes/AddCreditNote";
import EditCreditNote from "@pages/admin/credit-notes/EditCreditNote";
import OverviewCreditNote from "@pages/admin/credit-notes/OverviewCreditNote";
import InventoryList from "@pages/admin/inventory/InventoryList";
import EmailSettings from "@pages/admin/settings/systemSettings/EmailSettings";
import DeliveryChallanList from "@pages/admin/delivery-challan/DeliveryChallanList";
import NewDeliveryChallan from "@pages/admin/delivery-challan/NewDeliveryChallan";
import RolesList from "@pages/admin/roles-permissions/RolesList";
import EditDeliveryChallan from "@pages/admin/delivery-challan/EditDeliveryChallan";
import ViewDeliveryChallan from "@pages/admin/delivery-challan/ViewDeliveryChallan";
import UserList from "@pages/admin/users/UserList";
import RolePermissions from "@pages/admin/roles-permissions/RolePermissions";
import Unauthorized from "@pages/admin/errors/Unauthorized";
import ReportCenter from "@pages/admin/reports/ReportCenter";
import PurchaseReport from "@pages/admin/reports/transaction-reports/PurchaseReport";
import PurchaseOrderReport from "@pages/admin/reports/transaction-reports/PurchaseOrderReport";
import EmailTemplateList from "@pages/admin/settings/systemSettings/EmailTemplateList";
import PurchaseReturnReport from "@pages/admin/reports/transaction-reports/PurchaseReturnReport";
import QuotationReport from "@pages/admin/reports/transaction-reports/QuotationReport";
import SalesReport from "@pages/admin/reports/transaction-reports/SalesReport";
import SalesReturnReport from "@pages/admin/reports/transaction-reports/SalesReturnReport";
import StaffActivityReport from "@pages/admin/reports/transaction-reports/StaffActivityReport";
import IncomeReport from "@pages/admin/reports/accounting-reports/IncomeReport";
import ProfileSettings from "@pages/admin/settings/ProfileSettings";
import ExpenseReport from "@pages/admin/reports/accounting-reports/ExpenseReport";
import InventoryReport from "@pages/admin/reports/inventory-reports/InventoryReport";
import LowStockReport from "@pages/admin/reports/inventory-reports/LowStockReport";
import OutOfStockReport from "@pages/admin/reports/inventory-reports/OutOfStockReport";
import ExpenseList from "@pages/admin/finance-and-accounting/ExpenseList";
import ExpenseView from "@pages/admin/finance-and-accounting/ExpenseView";
import Seo from "@components/admin/Seo";
import OverviewPurchase from "@pages/admin/purchases/OverviewPurchase";
import OverviewPurchaseOrder from "@pages/admin/purchases/OverviewPurchaseOrder";
import EmailInvoice from "@pages/admin/invoices/EmailInvoice";
import EditPurchase from "@pages/admin/purchases/EditPurchase";
import ExpenseCategoryList from "@pages/admin/finance-and-accounting/ExpenseCategoryList";
import PettyCashList from "@pages/admin/finance-and-accounting/PettyCashList";
import BankTransactionList from "@pages/admin/finance-and-accounting/BankTransactionList";
import BankTransactionsBanking from "@pages/admin/banking/BankTransactionList";
import Banking from "@pages/admin/finance-and-accounting/Banking";
import ReconciliationList from "@pages/admin/finance-and-accounting/ReconciliationList";
import Reminder from "@pages/admin/settings/systemSettings/Reminder";
import QuotationSettings from "@pages/admin/settings/moduleSettings/quotation/QuotationSettings";
import EmailQuotation from "@pages/admin/quotations/EmailQuotation";
import ViewQuotation from "@pages/admin/quotations/ViewQuotation";
import ExpenseSettings from "@pages/admin/settings/moduleSettings/expense/ExpenseSettings";
import InvoiceSettings from "@pages/admin/settings/moduleSettings/invoice/InvoiceSettings";
import NotFound from "@pages/errors/NotFound";
import GetHelp from "@pages/admin/help/GetHelp";
import PurchaseSettings from "@pages/admin/settings/moduleSettings/purchase/PurchaseSettings";
import PurchaseOrderSettings from "@pages/admin/settings/moduleSettings/purchaseOrder/PurchaseOrderSettings";
import ProductSettings from "@pages/admin/settings/moduleSettings/product/ProductSettings";
import CategorySettings from "@pages/admin/settings/moduleSettings/category/CategorySettings";
import BrandSettings from "@pages/admin/settings/moduleSettings/brand/BrandSettings";
import UnitSettings from "@pages/admin/settings/moduleSettings/unit/UnitSettings";
import PaymentTransactionList from "@pages/admin/payments/PaymentTransactionList";
import PaymentGateways from "@pages/admin/settings/PaymentGateways";
import RazorpayConfig from "@pages/admin/settings/RazorpayConfig";
import StripeConfig from "@pages/admin/settings/StripeConfig";
import AccountingIntegrations from "@pages/admin/settings/AccountingIntegrations";
import MessagingSettings from "@pages/admin/settings/MessagingSettings";
import AiSettings from "@pages/admin/settings/AiSettings";
import ExtractionHistory from "@pages/admin/ai/ExtractionHistory";
import ChartOfAccountsList from "@pages/admin/accounting/ChartOfAccountsList";
import JournalEntryList from "@pages/admin/accounting/JournalEntryList";
import CreateJournalEntry from "@pages/admin/accounting/CreateJournalEntry";
import ProfitLossReport from "@pages/admin/accounting/reports/ProfitLossReport";
import BalanceSheetReport from "@pages/admin/accounting/reports/BalanceSheetReport";
import TrialBalanceReport from "@pages/admin/accounting/reports/TrialBalanceReport";
import TaxSummaryReport from "@pages/admin/accounting/reports/TaxSummaryReport";
import GSTR1Report from "@pages/admin/accounting/reports/GSTR1Report";
import GSTR3BReport from "@pages/admin/accounting/reports/GSTR3BReport";
import TaxReturns from "@pages/admin/accounting/TaxReturns";
import ArAgingReport from "@pages/admin/accounting/reports/ArAgingReport";
import ApAgingReport from "@pages/admin/accounting/reports/ApAgingReport";
import CollectionsReport from "@pages/admin/accounting/reports/CollectionsReport";
import BudgetVarianceReport from "@pages/admin/accounting/reports/BudgetVarianceReport";
import CashFlowForecastReport from "@pages/admin/accounting/reports/CashFlowForecastReport";
import PnlByDimensionReport from "@pages/admin/accounting/reports/PnlByDimensionReport";
import PnlByDepartmentReport from "@pages/admin/accounting/reports/PnlByDepartmentReport";
import TallyCheckReport from "@pages/admin/accounting/reports/TallyCheckReport";
import AccountingPeriods from "@pages/admin/accounting/AccountingPeriods";
import EInvoiceList from "@pages/admin/accounting/EInvoiceList";
import ActivityLogList from "@pages/admin/activityLog/ActivityLogList";
import Budgets from "@pages/admin/accounting/Budgets";
import CostCenters from "@pages/admin/accounting/CostCenters";
import Projects from "@pages/admin/accounting/Projects";
import FixedAssets from "@pages/admin/accounting/FixedAssets";
import ApprovalsQueue from "@pages/admin/accounting/ApprovalsQueue";
import CostLayers from "@pages/admin/inventory/CostLayers";
import InventoryView from "@pages/admin/inventory/InventoryView";
import MyMoney from "@pages/admin/my-money/MyMoney";
import PayrollProfiles from "@pages/admin/payroll/PayrollProfiles";
import PayRuns from "@pages/admin/payroll/PayRuns";
import MyTimesheet from "@pages/admin/payroll/MyTimesheet";
import TimesheetApprovals from "@pages/admin/payroll/TimesheetApprovals";
import TimeReports from "@pages/admin/payroll/TimeReports";
import MyLeave from "@pages/admin/payroll/MyLeave";
import LeaveApprovals from "@pages/admin/payroll/LeaveApprovals";
import Holidays from "@pages/admin/payroll/Holidays";
import LeaveTypes from "@pages/admin/payroll/LeaveTypes";
import LeaveReport from "@pages/admin/payroll/LeaveReport";
import ContactList from "@pages/admin/contacts/ContactList";
import ContactForm from "@pages/admin/contacts/ContactForm";
import ContactCard from "@pages/admin/contacts/ContactCard";

const AdminRoute = () => {
    return (
        <Routes>
            <Route element={<AdminLayout />}>
                {/* Dashboard */}
                <Route element={<ProtectedRoute moduleSlug="dashboard" action="view" />}>
                    <Route
                        index
                        element={<><Seo title="Dashboard" /><AdminDashboard /></>}
                    />
                </Route>

                <Route element={<ProtectedRoute moduleSlug="dashboard" action="view" />}>
                    <Route path="/dashboard" element={<><Seo title="Dashboard" /><AdminDashboard /></>} />
                    <Route path="/dashboard/sales" element={<><Seo title="Sales & Invoices" /><SalesDashboard /></>} />
                    <Route path="/dashboard/accounts" element={<><Seo title="Accounts & P&L" /><AccountsDashboard /></>} />
                    <Route path="/dashboard/expenses" element={<><Seo title="Expenses" /><ExpensesDashboard /></>} />
                </Route>

                {/* Product & Services */}
                <Route element={<ProtectedRoute moduleSlug="product-services" action="view" />}>
                    <Route path="/units" element={<><Seo title="Units" /><UnitList /></>} />
                    <Route path="/brands" element={<><Seo title="Brands" /><BrandList /></>} />
                    <Route path="/categories" element={<><Seo title="Categories" /><CategoryList /></>} />
                    <Route path="/products" element={<><Seo title="Items" /><ProductList /></>} />
                    <Route path="/products/new" element={<><Seo title="New Item" /><AddProduct /></>} />
                    <Route path="/products/edit/:id" element={<><Seo title="Edit Item" /><EditProduct /></>} />
                    <Route path="/products/view/:id" element={<><Seo title="Item" /><ViewProduct /></>} />
                </Route>

                {/* Inventory */}
                <Route element={<ProtectedRoute moduleSlug="inventory" action="view" />}>
                    <Route path="/inventory" element={<><Seo title="Inventory" /><InventoryList /></>} />
                    <Route path="/inventory/view/:id" element={<><Seo title="Inventory Item" /><InventoryView /></>} />
                    <Route path="/inventory/cost-layers" element={<><Seo title="Cost Layers" /><CostLayers /></>} />
                </Route>

                {/* Invoices */}
                <Route element={<ProtectedRoute moduleSlug="invoices" action="view" />}>
                    <Route path="/invoices" element={<><Seo title="Invoices" /><InvoiceList /></>} />
                    <Route path="/invoices/create-invoice" element={<><Seo title="New Invoice" /><CreateInvoice /></>} />
                    <Route path="/invoices/edit-invoice/:invoiceId" element={<><Seo title="Edit Invoice" /><EditInvoice /></>} />
                    <Route path="/invoices/email/:invoiceId" element={<><Seo title="Email Invoice" /><EmailInvoice /></>} />
                    <Route path="/invoice-templates" element={<><Seo title="Invoice Templates" /><InvoiceTemplateList /></>} />
                    <Route path="/recurring-invoices" element={<><Seo title="Recurring Invoices" /><RecurringInvoiceList /></>} />
                    <Route path="/view-invoice/:id" element={<><Seo title="Invoice" /><ViewInvoice /></>} />
                </Route>

                {/* Recurring Invoice Schedules (dedicated non-posting template editor) */}
                <Route element={<ProtectedRoute moduleSlug="recurring-invoices" action="view" />}>
                    <Route path="/recurring-schedules/new" element={<><Seo title="New Recurring Schedule" /><RecurringScheduleForm /></>} />
                    <Route path="/recurring-schedules/edit/:id" element={<><Seo title="Edit Recurring Schedule" /><RecurringScheduleForm /></>} />
                </Route>

                {/* Credit Notes */}
                <Route element={<ProtectedRoute moduleSlug="credit-notes" action="view" />}>
                    <Route path="/credit-notes" element={<><Seo title="Credit Notes" /><CreditNoteList /></>} />
                    <Route path="/credit-notes/new" element={<><Seo title="New Credit Note" /><AddCreditNote /></>} />
                    <Route path="/credit-notes/edit/:id" element={<><Seo title="Edit Credit Note" /><EditCreditNote /></>} />
                    <Route path="/credit-notes/view/:id" element={<><Seo title="Credit Note" /><OverviewCreditNote /></>} />
                </Route>

                {/* Quotations */}
                <Route element={<ProtectedRoute moduleSlug="quotations" action="view" />}>
                    <Route path="/quotations" element={<><Seo title="Quotations" /><QuotationList /></>} />
                    <Route path="/quotations/new" element={<><Seo title="New Quotation" /><CreateNewQuotation /></>} />
                    <Route path="/quotations/edit/:id" element={<><Seo title="Edit Quotation" /><EditQuotation /></>} />
                    <Route path="/quotations/email/:id" element={<><Seo title="Email Quotation" /><EmailQuotation /></>} />
                    <Route path="/view-quotation/:id" element={<><Seo title="Quotation" /><ViewQuotation /></>} />
                </Route>

                {/* Delivery Challans */}
                <Route element={<ProtectedRoute moduleSlug="delivery-challans" action="view" />}>
                    <Route path="/delivery-challans" element={<><Seo title="Delivery Challans" /><DeliveryChallanList /></>} />
                    <Route path="/delivery-challans/new" element={<><Seo title="New Delivery Challan" /><NewDeliveryChallan /></>} />
                    <Route path="/delivery-challans/edit/:id" element={<><Seo title="Edit Delivery Challan" /><EditDeliveryChallan /></>} />
                    <Route path="/delivery-challans/view/:id" element={<><Seo title="View Delivery Challan" /><ViewDeliveryChallan /></>} />
                </Route>

                {/* Customers — list redirects to Contacts; detail/edit/statement routes kept for deep links */}
                <Route element={<ProtectedRoute moduleSlug="customers" action="view" />}>
                    <Route path="/customers" element={<Navigate to="/contacts" replace />} />
                    <Route path="/customers/new" element={<><Seo title="New Customer" /><CustomerForm /></>} />
                    <Route path="/customers/edit/:id" element={<><Seo title="Edit Customer" /><EditCustomer /></>} />
                    <Route path="/customers/:id/statement" element={<><Seo title="Customer Statement" /><CustomerStatement /></>} />
                </Route>

                {/* Contacts */}
                <Route element={<ProtectedRoute moduleSlug="contacts" action="view" />}>
                    <Route path="/contacts" element={<><Seo title="Contacts" /><ContactList /></>} />
                    <Route path="/contacts/new" element={<><Seo title="New Contact" /><ContactForm /></>} />
                    <Route path="/contacts/edit/:id" element={<><Seo title="Edit Contact" /><ContactForm /></>} />
                    <Route path="/contacts/:id" element={<><Seo title="Contact" /><ContactCard /></>} />
                </Route>

                {/* Vehicles */}
                <Route path="/vehicles" element={<><Seo title="Vehicles" /><VehicleList /></>} />
                <Route path="/vehicles/new" element={<><Seo title="New Vehicle" /><CreateVehicle /></>} />
                <Route path="/vehicles/edit/:id" element={<><Seo title="Edit Vehicle" /><EditVehicle /></>} />

                {/* Purchase Module */}
                <Route element={<ProtectedRoute moduleSlug="purchase-orders" action="view" />}>
                    <Route path="/purchase-orders" element={<><Seo title="Purchase Orders" /><PurchaseOrderList /></>} />
                    <Route path="/purchase-orders/new" element={<><Seo title="New Purchase Order" /><CreatePurchaseOrder /></>} />
                    <Route path="/purchase-orders/edit/:id" element={<><Seo title="Edit Purchase Order" /><EditPurchaseOrder /></>} />
                    <Route path="/purchase-orders/view/:id" element={<><Seo title="Purchase Order" /><OverviewPurchaseOrder /></>} />
                </Route>

                <Route element={<ProtectedRoute moduleSlug="purchase-list" action="view" />}>
                    <Route path="/purchases" element={<><Seo title="Purchases" /><PurchaseList /></>} />
                    <Route path="/purchases/new" element={<><Seo title="New Purchase" /><CreatePurchase /></>} />
                    <Route path="/purchases/edit/:id" element={<><Seo title="Edit Purchase" /><EditPurchase /></>} />
                    <Route path="/purchases/view/:id" element={<><Seo title="Purchase Overview" /><OverviewPurchase /></>} />
                    <Route path="/supplier-balances" element={<><Seo title="Supplier Balances" /><SupplierBalances /></>} />
                </Route>

                <Route element={<ProtectedRoute moduleSlug="debit-notes" action="view" />}>
                    <Route path="/debit-notes" element={<><Seo title="Debit Notes" /><DebitNoteList /></>} />
                    <Route path="/debit-notes/new" element={<><Seo title="New Debit Note" /><CreateDebitNote /></>} />
                    <Route path="/debit-notes/view/:id" element={<><Seo title="Debit Note Overview" /><OverviewDebitNote /></>} />
                </Route>

                {/* Suppliers — list redirects to Contacts */}
                <Route element={<ProtectedRoute moduleSlug="suppliers" action="view" />}>
                    <Route path="/suppliers" element={<Navigate to="/contacts" replace />} />
                </Route>

                <Route element={<ProtectedRoute moduleSlug="supplier-payments" action="view" />}>
                    <Route path="/supplier-payments" element={<><Seo title="Supplier Payments" /><SupplierPayments /></>} />
                </Route>

                {/* Finance & Accounting */}
                <Route element={<ProtectedRoute moduleSlug="banking" action="view" />}>
                    <Route path="/banking" element={<><Seo title="Banking" /><Banking /></>} />
                    <Route path="/banking/:bankId" element={<><Seo title="Banking" /><BankTransactionsBanking /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="bank-transactions" action="view" />}>
                    <Route path="/banking/transactions" element={<><Seo title="Bank Transactions" /><BankTransactionsBanking /></>} />
                    <Route path="/banking/reconciliation" element={<><Seo title="Reconciliation" /><ReconciliationList /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="expenses" action="view" />}>
                    <Route path="/expenses" element={<><Seo title="Expenses" /><ExpenseList /></>} />
                    <Route path="/expenses/view/:id" element={<><Seo title="Expense" /><ExpenseView /></>} />
                    <Route path="/expense-categories" element={<><Seo title="Expense Categories" /><ExpenseCategoryList /></>} />
                    <Route path="/transactions" element={<><Seo title="Transactions" /><BankTransactionList /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="recurring-expenses" action="view" />}>
                    <Route path="/recurring-expenses" element={<><Seo title="Recurring Expenses" /><RecurringExpenseList /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="petty-cash" action="view" />}>
                    <Route path="/petty-cash" element={<><Seo title="Petty Cash" /><PettyCashList /></>} />
                </Route>
                <Route element={<ProtectedRoute />}>
                    <Route path="/my-money" element={<><Seo title="My Money" /><MyMoney /></>} />
                </Route>
                <Route element={<ProtectedRoute />}>
                    <Route path="/payroll/profiles" element={<><Seo title="Payroll Profiles" /><PayrollProfiles /></>} />
                    <Route path="/payroll/runs" element={<><Seo title="Pay Runs" /><PayRuns /></>} />
                </Route>

                {/* Time Tracking (Phase 1) */}
                <Route element={<ProtectedRoute moduleSlug="time-tracking" action="view" />}>
                    <Route path="/time-tracking/my-timesheet" element={<><Seo title="My Timesheet" /><MyTimesheet /></>} />
                    <Route path="/time-tracking/reports" element={<><Seo title="Time Reports" /><TimeReports /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="time-tracking-others" action="view" />}>
                    <Route path="/time-tracking/approvals" element={<><Seo title="Timesheet Approvals" /><TimesheetApprovals /></>} />
                </Route>

                {/* Leave & Holidays (Phase C) */}
                <Route element={<ProtectedRoute moduleSlug="time-tracking" action="view" />}>
                    <Route path="/leave/my-leave" element={<><Seo title="My Leave" /><MyLeave /></>} />
                    <Route path="/leave/report" element={<><Seo title="Leave Report" /><LeaveReport /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="time-tracking-others" action="view" />}>
                    <Route path="/leave/approvals" element={<><Seo title="Leave Approvals" /><LeaveApprovals /></>} />
                    <Route path="/leave/holidays" element={<><Seo title="Holidays" /><Holidays /></>} />
                    <Route path="/leave/leave-types" element={<><Seo title="Leave Types" /><LeaveTypes /></>} />
                </Route>

                {/* Accounting (slice F.1) */}
                <Route element={<ProtectedRoute moduleSlug="chart-of-accounts" action="view" />}>
                    <Route path="/accounting/chart-of-accounts" element={<><Seo title="Chart of Accounts" /><ChartOfAccountsList /></>} />
                </Route>
                <Route element={<ProtectedRoute moduleSlug="journal-entries" action="view" />}>
                    <Route path="/accounting/journal-entries" element={<><Seo title="Journal Entries" /><JournalEntryList /></>} />
                    <Route path="/accounting/journal-entries/new" element={<><Seo title="New Journal Entry" /><CreateJournalEntry /></>} />
                </Route>

                {/* Remaining accounting features all gate on the "accounting" module */}
                <Route element={<ProtectedRoute moduleSlug="accounting" action="view" />}>
                    {/* Financial Statements (slice F.2) */}
                    <Route path="/accounting/reports/profit-loss" element={<><Seo title="P&L" /><ProfitLossReport /></>} />
                    <Route path="/accounting/reports/balance-sheet" element={<><Seo title="Balance Sheet" /><BalanceSheetReport /></>} />
                    <Route path="/accounting/reports/trial-balance" element={<><Seo title="Trial Balance" /><TrialBalanceReport /></>} />

                    {/* Tax Reports (slice F.3) */}
                    <Route path="/accounting/reports/tax-summary" element={<><Seo title="Tax Summary" /><TaxSummaryReport /></>} />
                    <Route path="/accounting/reports/gstr-1" element={<><Seo title="GSTR-1" /><GSTR1Report /></>} />
                    <Route path="/accounting/reports/gstr-3b" element={<><Seo title="GSTR-3B" /><GSTR3BReport /></>} />

                    {/* Accounting Periods (slice F.4) */}
                    {/* (country tax returns route added separately below, gated on accounting-reports) */}
                    <Route path="/accounting/periods" element={<><Seo title="Accounting Periods" /><AccountingPeriods /></>} />

                    {/* Finance Reports (AR/AP Aging, Collections, Budget Variance, Cash Flow, P&L by Dimension) */}
                    <Route path="/accounting/reports/ar-aging" element={<><Seo title="AR Aging" /><ArAgingReport /></>} />
                    <Route path="/accounting/reports/ap-aging" element={<><Seo title="AP Aging" /><ApAgingReport /></>} />
                    <Route path="/accounting/reports/collections" element={<><Seo title="Collections" /><CollectionsReport /></>} />
                    <Route path="/accounting/reports/budget-variance" element={<><Seo title="Budget Variance" /><BudgetVarianceReport /></>} />
                    <Route path="/accounting/reports/cash-flow-forecast" element={<><Seo title="Cash Flow Forecast" /><CashFlowForecastReport /></>} />
                    <Route path="/accounting/reports/pnl-by-dimension" element={<><Seo title="P&L by Dimension" /><PnlByDimensionReport /></>} />
                    <Route path="/accounting/reports/pnl-by-department" element={<><Seo title="P&L by Department" /><PnlByDepartmentReport /></>} />
                    <Route path="/accounting/reports/tally-check" element={<><Seo title="Tally Check" /><TallyCheckReport /></>} />

                    {/* E-Invoices (slice G.1) */}
                    <Route path="/accounting/e-invoices" element={<><Seo title="E-Invoices" /><EInvoiceList /></>} />

                    {/* Budgets, Cost Centers, Projects, Fixed Assets */}
                    <Route path="/accounting/budgets" element={<><Seo title="Budgets" /><Budgets /></>} />
                    <Route path="/accounting/cost-centers" element={<><Seo title="Profit Centers" /><CostCenters /></>} />
                    <Route path="/accounting/projects" element={<><Seo title="Projects" /><Projects /></>} />
                    <Route path="/accounting/fixed-assets" element={<><Seo title="Fixed Assets" /><FixedAssets /></>} />
                    <Route path="/accounting/approvals" element={<><Seo title="Approvals Queue" /><ApprovalsQueue /></>} />
                </Route>

                {/* Country tax returns (regime-aware: UK VAT / AU BAS / NZ GST / EU VAT) */}
                <Route element={<ProtectedRoute moduleSlug="accounting-reports" action="view" />}>
                    <Route path="/accounting/tax-returns" element={<><Seo title="Tax Returns" /><TaxReturns /></>} />
                </Route>

                {/* Payments */}
                <Route element={<ProtectedRoute moduleSlug="payment-transactions" action="view" />}>
                    <Route path="/payments/transactions" element={<><Seo title="Transactions" /><PaymentTransactionList /></>} />
                </Route>
                <Route path="/ai/extractions" element={<><Seo title="AI Extractions" /><ExtractionHistory /></>} />

                {/* Activity Log */}
                <Route element={<ProtectedRoute moduleSlug="activity-log" action="view" />}>
                  <Route path="/activity-log" element={<><Seo title="Activity Log" /><ActivityLogList /></>} />
                </Route>

                {/* Roles & Permissions */}
                <Route element={<ProtectedRoute moduleSlug="manage-users" action="view" />}>
                    <Route path="/users" element={<><Seo title="Users" /><UserList /></>} />
                    <Route path="/roles" element={<><Seo title="Roles" /><RolesList /></>} />
                    <Route path="/roles/permissions/:id" element={<><Seo title="Role Permissions" /><RolePermissions /></>} />
                </Route>

                {/* Reports Center — the index of every report. Ungated: it only
                    ever lists the reports the viewer's permissions allow, and
                    the individual report routes below keep their own guards.
                    The static `/reports/*` paths below still win the match,
                    since React Router ranks a longer static path higher. */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/reports" element={<><Seo title="Reports" /><ReportCenter /></>} />
                </Route>

                {/* Reports - Transaction */}
                <Route element={<ProtectedRoute moduleSlug="transaction-reports" action="view" />}>
                    <Route path="/reports/sales" element={<><Seo title="Sales Report" /><SalesReport /></>} />
                    <Route path="/reports/sales-return" element={<><Seo title="Sales Return Report" /><SalesReturnReport /></>} />
                    <Route path="/reports/purchase" element={<><Seo title="Purchase Report" /><PurchaseReport /></>} />
                    <Route path="/reports/purchase-order" element={<><Seo title="Purchase Order Report" /><PurchaseOrderReport /></>} />
                    <Route path="/reports/purchase-return" element={<><Seo title="Purchase Return Report" /><PurchaseReturnReport /></>} />
                    <Route path="/reports/quotation" element={<><Seo title="Quotation Report" /><QuotationReport /></>} />
                    <Route path="/reports/staff-activity" element={<><Seo title="Staff Activity Report" /><StaffActivityReport /></>} />
                </Route>

                {/* Reports - Accounting */}
                <Route element={<ProtectedRoute moduleSlug="accounting-reports" action="view" />}>
                    <Route path="/reports/income" element={<><Seo title="Income Report" /><IncomeReport /></>} />
                    <Route path="/reports/expense" element={<><Seo title="Expense Report" /><ExpenseReport /></>} />
                </Route>

                {/* Reports - Inventory */}
                <Route element={<ProtectedRoute moduleSlug="item-reports" action="view" />}>
                    <Route path="/reports/inventory" element={<><Seo title="Inventory Report" /><InventoryReport /></>} />
                    <Route path="/reports/low-stock" element={<><Seo title="Low Stock Report" /><LowStockReport /></>} />
                    <Route path="/reports/out-of-stock" element={<><Seo title="Out Of Stock Report" /><OutOfStockReport /></>} />
                </Route>

                {/* Help — available to every signed-in user, no module permission */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/help" element={<><Seo title="Get Help" /><GetHelp /></>} />
                </Route>

                {/* Logout */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/logout" element={<AdminLogout />} />
                </Route>
            </Route>

            {/* Settings shell — its own left nav and "Close Settings" control
                replace the app sidebar for the whole /settings/* space. */}
            <Route element={<SettingsLayout />}>
                {/* The landing grid itself: any signed-in user can open it, and
                    it only ever shows the cards their permissions allow. */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/settings" element={<><Seo title="All Settings" /><AllSettings /></>} />
                </Route>

                {/* General Settings */}
                <Route element={<ProtectedRoute moduleSlug="general-settings" action="view" />}>
                    <Route path="/settings/account" element={<><Seo title="Account Settings" /><AccountSettings /></>} />
                    <Route path="/settings/profile" element={<><Seo title="Profile Settings" /><ProfileSettings /></>} />
                </Route>

                {/* Website Settings */}
                <Route element={<ProtectedRoute moduleSlug="website-settings" action="view" />}>
                    <Route path="/settings/company-settings" element={<><Seo title="Company Settings" /><CompanySettings /></>} />
                    <Route path="/settings/localization" element={<><Seo title="Localization Settings" /><LocalizationSettings /></>} />
                </Route>

                {/* System Settings */}
                <Route element={<ProtectedRoute moduleSlug="system-settings" action="view" />}>
                    <Route path="/settings/email-settings" element={<><Seo title="Email Settings" /><EmailSettings /></>} />
                    <Route path="/settings/email-templates" element={<><Seo title="Email Templates" /><EmailTemplateList /></>} />
                    <Route path="/settings/signatures" element={<><Seo title="Signatures" /><SignatureList /></>} />
                    <Route path="/settings/reminders" element={<><Seo title="Reminders" /><Reminder /></>} />
                </Route>

                {/* Module Settings */}
                <Route element={<ProtectedRoute moduleSlug="module-settings" action="view" />}>
                    <Route path="/settings/module-settings/invoice" element={<><Seo title="Module Settings - Invoice" /><InvoiceSettings /></>} />
                    <Route path="/settings/module-settings/purchase" element={<><Seo title="Module Settings - Purchase" /><PurchaseSettings /></>} />
                    <Route path="/settings/module-settings/purchase-order" element={<><Seo title="Module Settings - Purchase Order" /><PurchaseOrderSettings     /></>} />
                    <Route path="/settings/module-settings/expense" element={<><Seo title="Module Settings - Expense" /><ExpenseSettings /></>} />
                    <Route path="/settings/module-settings/quotations" element={<><Seo title="Module Settings - Quotations" /><QuotationSettings /></>} />
                    <Route path="/settings/module-settings/product" element={<><Seo title="Module Settings - Product" /><ProductSettings /></>} />
                    <Route path="/settings/module-settings/category" element={<><Seo title="Module Settings - Category" /><CategorySettings /></>} />
                    <Route path="/settings/module-settings/brand" element={<><Seo title="Module Settings - Brand" /><BrandSettings /></>} />
                    <Route path="/settings/module-settings/unit" element={<><Seo title="Module Settings - Unit" /><UnitSettings /></>} />
                </Route>

                {/* Finance Settings */}
                <Route element={<ProtectedRoute moduleSlug="finance-settings" action="view" />}>
                    <Route path="/settings/bank-accounts" element={<><Seo title="Bank Accounts" /><BankAccountList /></>} />
                    <Route path="/settings/tax-rates" element={<><Seo title="Taxes" /><TaxRateList /></>} />
                    <Route path="/settings/tax-rates/new" element={<><Seo title="New Tax" /><CreateTaxRate /></>} />
                    <Route path="/settings/tax-rates/edit/:id" element={<><Seo title="Edit Tax" /><EditTaxRate /></>} />
                    {/* Tax Groups merged into Taxes (spec 2026-07-12) — old deep links land on Taxes */}
                    <Route path="/settings/tax-groups" element={<Navigate to="/settings/tax-rates" replace />} />
                    <Route path="/settings/currencies" element={<><Seo title="Currencies" /><CurrencyList /></>} />
                    <Route path="/settings/ledger-setup" element={<><Seo title="Ledger Setup" /><LedgerSetupWizard /></>} />
                    <Route path="/settings/document-defaults" element={<><Seo title="Document Defaults" /><DocumentDefaultsPage /></>} />
                    <Route path="/settings/transaction-categories" element={<><Seo title="Transaction Categories" /><TransactionCategoriesPage /></>} />
                </Route>

                {/* Unguarded settings pages, relocated as-is: their access
                    control is unchanged by the shell move. */}
                <Route path="/settings/payment-gateways" element={<><Seo title="Payment Gateways" /><PaymentGateways /></>} />
                <Route path="/settings/payment-gateways/razorpay" element={<><Seo title="Razorpay Configuration" /><RazorpayConfig /></>} />
                <Route path="/settings/payment-gateways/stripe" element={<><Seo title="Stripe Configuration" /><StripeConfig /></>} />
                <Route path="/settings/accounting-integrations" element={<><Seo title="Accounting Integrations" /><AccountingIntegrations /></>} />
                <Route path="/settings/messaging" element={<><Seo title="Messaging" /><MessagingSettings /></>} />
                <Route path="/settings/ai" element={<><Seo title="AI Settings" /><AiSettings /></>} />
            </Route>

            {/* No Layout Routes ex: print,pdf,view */}

            {/* Error Routes */}
            <Route path="/unauthorized" element={<><Seo title="Unauthorized" /><Unauthorized /></>} />
            <Route path="*" element={<><Seo title="Not Found" /><NotFound /></>} />
        </Routes>
    );
};

export default AdminRoute;