import { createContext, useContext, type ReactNode } from "react";

/**
 * How deeply the current subtree is nested inside modal overlays.
 *
 * Create flows are Drawers, and a create flow routinely opens another one — a
 * Create Invoice drawer opens Create Product, which opens Create Unit. Each
 * level has to paint above the one below it, so z-index cannot be a constant
 * the way it was when `Modal` was the only overlay in the app.
 *
 * Depth is 0 for the first overlay on screen, 1 for one opened from inside it,
 * and so on. Both `Drawer` and `Modal` read it, and both provide `depth + 1`
 * to their children, so the two kinds interleave correctly in either order.
 */
const OverlayDepthContext = createContext(0);

export const useOverlayDepth = (): number => useContext(OverlayDepthContext);

export const OverlayDepthProvider = ({
  depth,
  children,
}: {
  depth: number;
  children: ReactNode;
}) => (
  <OverlayDepthContext.Provider value={depth}>
    {children}
  </OverlayDepthContext.Provider>
);

/**
 * z-index for one overlay level. 40 is where the app's overlay band starts;
 * 10 per level leaves room for a backdrop and a panel without either colliding
 * with the next level down.
 */
export const overlayZ = (depth: number) => ({
  backdrop: 40 + depth * 10,
  panel: 45 + depth * 10,
});
