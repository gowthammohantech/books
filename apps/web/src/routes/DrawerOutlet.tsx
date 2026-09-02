import { createContext, useContext, type ReactNode } from "react";
import { Route, Routes, useLocation, type Location } from "react-router-dom";

import { drawerRoutesFor, isDrawerPath } from "./drawerRoutes";

import CreateInvoice from "@pages/admin/invoices/CreateInvoice";
import CreateNewQuotation from "@pages/admin/quotations/CreateNewQuotation";
import AddCreditNote from "@pages/admin/credit-notes/AddCreditNote";
import NewDeliveryChallan from "@pages/admin/delivery-challan/NewDeliveryChallan";
import CreatePurchaseOrder from "@pages/admin/purchases/CreatePurchaseOrder";
import CreatePurchase from "@pages/admin/purchases/CreatePurchase";
import CreateDebitNote from "@pages/admin/purchases/CreateDebitNote";
import AddProduct from "@pages/admin/productAndServices/AddProduct";
import ContactForm from "@pages/admin/contacts/ContactForm";
import CustomerForm from "@pages/admin/customers/CreateCustomer";
import CreateVehicle from "@pages/admin/vehicles/CreateVehicle";
import CreateJournalEntry from "@pages/admin/accounting/CreateJournalEntry";
import RecurringScheduleForm from "@pages/admin/recurring-invoices/RecurringScheduleForm";
import CreateTaxRate from "@pages/admin/settings/taxRates/CreateTaxRate";

/**
 * The real browser location, as opposed to the one the primary route tree is
 * being rendered at.
 *
 * `<Routes location={background}>` does not merely match against `background` —
 * react-router wraps everything it renders in a LocationContext carrying that
 * location. So inside AdminLayout, `useLocation()` returns the LIST's location
 * while a drawer is open, and a nested <Routes> would never match the drawer
 * path. This context carries the real one past that override.
 *
 * That same override is why neither shell needs a "don't scroll to top when a
 * drawer opens" guard: their scroll-to-top effects key on the background
 * pathname, which does not change when a drawer opens over the page.
 */
const RealLocationContext = createContext<Location | null>(null);

export const RealLocationProvider = ({
  location,
  children,
}: {
  location: Location;
  children: ReactNode;
}) => (
  <RealLocationContext.Provider value={location}>
    {children}
  </RealLocationContext.Provider>
);

const ELEMENTS: Record<string, ReactNode> = {
  "/invoices/create-invoice": <CreateInvoice />,
  "/quotations/new": <CreateNewQuotation />,
  "/credit-notes/new": <AddCreditNote />,
  "/delivery-challans/new": <NewDeliveryChallan />,
  "/purchase-orders/new": <CreatePurchaseOrder />,
  "/purchases/new": <CreatePurchase />,
  "/debit-notes/new": <CreateDebitNote />,
  "/products/new": <AddProduct />,
  "/contacts/new": <ContactForm />,
  "/customers/new": <CustomerForm />,
  "/vehicles/new": <CreateVehicle />,
  "/accounting/journal-entries/new": <CreateJournalEntry />,
  "/recurring-schedules/new": <RecurringScheduleForm />,
  "/settings/tax-rates/new": <CreateTaxRate />,
};

/**
 * Renders the create-flow drawer for the current URL, over whatever the primary
 * route tree put behind it. Mounted inside each shell rather than beside the
 * router so the drawers sit inside PageHeaderProvider, CommandPaletteProvider
 * and AgentPanelProvider like any other page.
 */
const DrawerOutlet = ({ shell }: { shell: "admin" | "settings" }) => {
  const contextLocation = useContext(RealLocationContext);
  const fallback = useLocation();
  const location = contextLocation ?? fallback;

  if (!isDrawerPath(location.pathname)) return null;

  return (
    <Routes location={location}>
      {drawerRoutesFor(shell).map(({ path }) => (
        <Route key={path} path={path} element={ELEMENTS[path]} />
      ))}
      <Route path="*" element={null} />
    </Routes>
  );
};

export default DrawerOutlet;
