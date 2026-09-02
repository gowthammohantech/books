/**
 * The create flows that present as a right-side drawer over their list.
 *
 * Each of these paths stays a real, deep-linkable URL — they are linked from
 * the sidebar quick-add (lib/navigation.tsx `addPath`), the command palette
 * (lib/commandPalette.ts), every list page's New button, the dashboard, and in
 * one case from a `window.open(..., '_blank')` in EditInvoice. What changes is
 * only what renders: the list at `parent` fills the shell, and the create
 * screen is a drawer over it.
 */
export interface DrawerRoute {
  /** The create URL. Unchanged from before the drawer work. */
  path: string;
  /** What renders behind the drawer on a cold load, refresh, or pasted link. */
  parent: string;
  /** Which shell mounts the DrawerOutlet that renders it. */
  shell: "admin" | "settings";
}

/**
 * Twelve of the fourteen parents are mechanically "the path minus its last
 * segment". The two that are not are called out below — which is exactly why
 * this is a table and not a string operation. A wrong parent is a blank page
 * behind a drawer, and it would only show up on a cold load.
 */
export const DRAWER_ROUTES: DrawerRoute[] = [
  { path: "/invoices/create-invoice", parent: "/invoices", shell: "admin" },
  { path: "/quotations/new", parent: "/quotations", shell: "admin" },
  { path: "/credit-notes/new", parent: "/credit-notes", shell: "admin" },
  { path: "/delivery-challans/new", parent: "/delivery-challans", shell: "admin" },
  { path: "/purchase-orders/new", parent: "/purchase-orders", shell: "admin" },
  { path: "/purchases/new", parent: "/purchases", shell: "admin" },
  { path: "/debit-notes/new", parent: "/debit-notes", shell: "admin" },
  { path: "/products/new", parent: "/products", shell: "admin" },
  { path: "/contacts/new", parent: "/contacts", shell: "admin" },
  { path: "/vehicles/new", parent: "/vehicles", shell: "admin" },
  {
    path: "/accounting/journal-entries/new",
    parent: "/accounting/journal-entries",
    shell: "admin",
  },
  // There is no /recurring-schedules list route — the schedules are listed on
  // /recurring-invoices.
  {
    path: "/recurring-schedules/new",
    parent: "/recurring-invoices",
    shell: "admin",
  },
  // /customers is a <Navigate to="/contacts" replace />, so pointing the
  // backdrop at it would render a redirect rather than a list.
  { path: "/customers/new", parent: "/contacts", shell: "admin" },
  { path: "/settings/tax-rates/new", parent: "/settings/tax-rates", shell: "settings" },
];

const BY_PATH = new Map(DRAWER_ROUTES.map((r) => [r.path, r]));

export const isDrawerPath = (pathname: string): boolean => BY_PATH.has(pathname);

export const parentOf = (pathname: string): string | undefined =>
  BY_PATH.get(pathname)?.parent;

export const drawerRoutesFor = (shell: DrawerRoute["shell"]): DrawerRoute[] =>
  DRAWER_ROUTES.filter((r) => r.shell === shell);

/**
 * The location the primary route tree should render at.
 *
 * `backgroundLocation` is set by useOpenDrawer when a drawer is opened from
 * inside the app, so the page you were on stays mounted. When it is absent —
 * a pasted link, a refresh, a new tab, a call site that has not been wired —
 * the create route's list stands in, which is what DrawerFallback supplies.
 * Returns null when the URL is not a drawer route at all.
 */
export const backgroundPathFor = (pathname: string): string | null =>
  parentOf(pathname) ?? null;

export type DrawerCloseAction =
  | { action: "back" }
  | { action: "replace"; to: string };

/**
 * What closing a route drawer should do.
 *
 * `default` is the key react-router gives the first entry of a session. There
 * is nothing behind it, so going back would leave the app entirely — land on
 * the list instead. Anything else was pushed, and Back is the same gesture as
 * the drawer's own close, which is the point of keeping these in sync.
 */
export const drawerCloseAction = (
  locationKey: string,
  pathname: string,
): DrawerCloseAction =>
  locationKey !== "default"
    ? { action: "back" }
    : { action: "replace", to: parentOf(pathname) ?? "/" };
