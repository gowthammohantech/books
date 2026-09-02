import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { parentOf } from "@/routes/drawerRoutes";

export interface DrawerRouteState {
  /** Always true while the drawer's route is matched — the route IS the state. */
  isOpen: boolean;
  /** Wire to the drawer's onClose, and to the form's Cancel button. */
  close: () => void;
  /** The list this drawer sits over. Useful for a post-save redirect. */
  parentPath: string;
}

/**
 * Shared close behaviour for the create screens that render as route drawers.
 *
 * Extracted rather than repeated fourteen times, and because getting the two
 * cases wrong is silent: `navigate(-1)` on a cold-loaded drawer walks out of
 * the app entirely, and a `replace` on a pushed entry leaves a create URL in
 * the history that Back can never reach.
 */
export const useDrawerRoute = (): DrawerRouteState => {
  const navigate = useNavigate();
  const location = useLocation();
  const parentPath = parentOf(location.pathname) ?? "/";

  const close = useCallback(() => {
    // `default` is the key react-router gives the first entry of a session —
    // a pasted link, a refresh, or a new tab. There is nothing to go back to,
    // so land on the list instead of leaving the site.
    if (location.key !== "default") navigate(-1);
    else navigate(parentPath, { replace: true });
  }, [location.key, navigate, parentPath]);

  return { isOpen: true, close, parentPath };
};

export default useDrawerRoute;
