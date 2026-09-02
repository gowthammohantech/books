/**
 * z-index for one overlay level. 40 is where the app's overlay band starts;
 * 10 per level leaves room for a backdrop and a panel without either colliding
 * with the next level down.
 *
 * Both Drawer and Modal use this, so the two kinds interleave correctly in
 * either order — a confirm opened from a drawer paints above it, and a drawer
 * opened from a drawer paints above that.
 */
export const overlayZ = (depth: number) => ({
  backdrop: 40 + depth * 10,
  panel: 45 + depth * 10,
});
