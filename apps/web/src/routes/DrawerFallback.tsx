import { Navigate, useLocation } from "react-router-dom";

import { backgroundPathFor } from "./drawerRoutes";

/**
 * What a create route renders in the PRIMARY route tree.
 *
 * The primary tree is driven by `location.state.backgroundLocation` when one is
 * set, so it normally matches the list and this never mounts. It mounts on the
 * cold-load path — a pasted URL, a refresh, a `window.open` into a new tab, or
 * a `navigate()` that did not go through useOpenDrawer — and replaces the
 * history entry with the same URL, now carrying a synthetic background pointing
 * at the list. The primary tree then renders the list, and DrawerOutlet renders
 * the drawer over it.
 *
 * That is what makes the scheme fail-safe: a missed call site degrades to "the
 * list is behind the drawer instead of the page you were on", never to a URL
 * that does not work.
 *
 * No render loop — once the state is set, the primary tree matches the list and
 * this component is out of the tree.
 */
const DrawerFallback = () => {
  const location = useLocation();
  const parent = backgroundPathFor(location.pathname);

  // Unreachable: drawerRoutes.test.ts asserts every drawer path has a parent.
  if (!parent) return null;

  return (
    <Navigate
      replace
      to={{ pathname: location.pathname, search: location.search }}
      state={{
        backgroundLocation: {
          pathname: parent,
          search: "",
          hash: "",
          state: null,
          key: "drawer-fallback",
        },
      }}
    />
  );
};

export default DrawerFallback;
