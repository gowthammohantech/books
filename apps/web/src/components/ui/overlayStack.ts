/**
 * One stack for every modal overlay in the app — centred Modals and right-hand
 * Drawers alike.
 *
 * Escape must close only the topmost overlay when overlays nest, and now that
 * create flows are Drawers a nest can mix the two kinds: a Create Invoice
 * drawer opens a Create Product drawer, which opens a centred confirm. A stack
 * private to Modal.tsx (where this logic started) could only see half of that,
 * so a drawer's Escape would fall through into the modal underneath it.
 *
 * Sharing the stack also buys correct focus restoration for free: popping
 * level 2 restores focus to the element that was active inside level 1.
 */
const stack: symbol[] = [];

/**
 * Everything behind an overlay is made genuinely inert, not merely covered.
 * The overlays portal to <body>, outside the `#root` React mounts into, so
 * marking the root blocks tab order, click-through and the screen-reader
 * virtual cursor in one attribute. React 19 passes `inert` through natively.
 */
const ROOT_ID = "root";

const syncShell = (): void => {
  if (typeof document === "undefined") return;
  const root = document.getElementById(ROOT_ID);
  if (stack.length > 0) {
    root?.setAttribute("inert", "");
    // Read by the @media print rules in index.css, which swap a fixed panel
    // for a printable block, and by scripts/audit-layout.mjs.
    document.body.dataset.overlayOpen = "";
  } else {
    root?.removeAttribute("inert");
    delete document.body.dataset.overlayOpen;
  }
};

export const pushOverlay = (id: symbol): void => {
  stack.push(id);
  syncShell();
};

/**
 * Cleanup order across nested overlays is not guaranteed LIFO — React unmounts
 * a subtree's effects in its own order — so remove by identity rather than
 * assuming this entry is on top.
 */
export const removeOverlay = (id: symbol): void => {
  const idx = stack.indexOf(id);
  if (idx !== -1) stack.splice(idx, 1);
  syncShell();
};

export const isTopmostOverlay = (id: symbol): boolean =>
  stack[stack.length - 1] === id;

/** How many overlays are open, the caller's own included. */
export const overlayCount = (): number => stack.length;
