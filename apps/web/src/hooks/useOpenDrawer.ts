import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Opens a create drawer over the page you are on.
 *
 * The `backgroundLocation` is what keeps the current page MOUNTED behind the
 * drawer, so a list keeps its filters, page number and scroll position while
 * you create something. Without it the router falls back to re-mounting the
 * list from scratch (see DrawerFallback) — correct, but it refetches and
 * throws away where you were.
 *
 * So this is an improvement at each call site, never a correctness
 * requirement: a link that forgets it still lands on a working drawer.
 */
export const useOpenDrawer = (): ((to: string) => void) => {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (to: string) => navigate(to, { state: { backgroundLocation: location } }),
    [navigate, location],
  );
};

export default useOpenDrawer;
