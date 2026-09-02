import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";

import { confirmIfDirty } from "@hooks/useDirtyGuard";
import Button from "./Button";
import { overlayZ } from "./OverlayLayer";
import {
  isTopmostOverlay,
  overlayCount,
  pushOverlay,
  removeOverlay,
} from "./overlayStack";

export type DrawerWidth = "narrow" | "base" | "wide";

export interface DrawerProps {
  isOpen: boolean;
  /** Called after the exit transition. For a route drawer, navigate back. */
  onClose: () => void;
  title: ReactNode;
  /** One line under the title — a document number, a hint, a count. */
  description?: ReactNode;
  /** Controls left of the close button. */
  headerActions?: ReactNode;
  /**
   * The pinned footer. Pass <FormActions>. Submit buttons reach the form in
   * the body with `form="<id>"`, the same wiring the entity forms already use
   * with PageHeader — so no submit handler moves.
   */
  footer?: ReactNode;
  /** Confirm before discarding on backdrop-click / Escape / close button. */
  confirmOnClose?: boolean;
  /** Overrides the depth-derived width. `narrow` suits 1-3 field quick-creates. */
  width?: DrawerWidth;
  /** Removes the body padding, for a child that owns its own frame. */
  padded?: boolean;
  children: ReactNode;
}

/**
 * Panel width by nesting depth. The base create drawer is the 75% the design
 * calls for; each level inside it insets by a constant 40px so the parent's
 * left edge stays visible and a stack reads as a stack rather than as one
 * panel that silently changed contents.
 *
 * Percentages only above `md` — below it every level is full-width, because a
 * 75% panel on a phone is a modal with a useless gutter, and a 40px peek is
 * noise rather than orientation. Level 3+ clamps to level 2 instead of
 * marching further left; a fourth level is a design smell, not a case to
 * accommodate.
 */
const WIDTH_BY_DEPTH = [
  "md:w-[75%] md:max-w-[75rem]",
  "md:w-[calc(75%-2.5rem)] md:max-w-[72.5rem]",
  "md:w-[calc(75%-5rem)] md:max-w-[70rem]",
] as const;

const WIDTH_OVERRIDE: Record<DrawerWidth, string> = {
  narrow: "md:w-[38rem] md:max-w-[38rem]",
  base: "md:w-[75%] md:max-w-[75rem]",
  wide: "md:w-[85%] md:max-w-[90rem]",
};

const EXIT_MS = 200;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const Drawer = ({
  isOpen,
  onClose,
  title,
  description,
  headerActions,
  footer,
  confirmOnClose = false,
  width,
  padded = true,
  children,
}: DrawerProps) => {
  const panelRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const idRef = useRef(Symbol("drawer"));
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();

  // Depth is read from the live overlay stack, not from React context: a
  // drawer is frequently a SIBLING of the one that opened it rather than a
  // descendant, and context would report every such panel as depth 0 — same
  // width, same z-index, no visible stack. Captured on the first open render,
  // before the effect below pushes, so width and z-index are right on the
  // very first paint.
  const depthRef = useRef<number | null>(null);
  if (isOpen && depthRef.current === null) depthRef.current = overlayCount();
  if (!isOpen && depthRef.current !== null) depthRef.current = null;
  const depth = depthRef.current ?? 0;

  // The panel starts off-screen and transitions in on the next frame; `closing`
  // drives the same transition in reverse before onClose actually fires.
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

  // Every discard goes through the shared confirm, so backdrop-click and
  // Escape cannot silently drop a half-filled create form.
  const requestClose = useCallback(() => {
    if (!confirmIfDirty(confirmOnClose)) return;
    if (exitTimerRef.current) return;
    const wait = prefersReducedMotion() ? 0 : EXIT_MS;
    setClosing(true);
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      onClose();
    }, wait);
  }, [confirmOnClose, onClose]);

  useEffect(
    () => () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement;

    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panelRef.current)?.focus();

    pushOverlay(idRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopmostOverlay(idRef.current)) return;

      if (e.key === "Escape") {
        requestClose();
        return;
      }

      if (e.key !== "Tab") return;
      // Keep Tab inside the panel — but only once focus is already in it, so a
      // portalled date-picker or MUI popover keeps its own keyboard handling.
      const panel = panelRef.current;
      if (!panel || !panel.contains(document.activeElement)) return;
      const items = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const raf = requestAnimationFrame(() => setEntered(true));

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      removeOverlay(idRef.current);
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const z = overlayZ(depth);
  const level = Math.min(depth, WIDTH_BY_DEPTH.length - 1);
  const widthClasses = width ? WIDTH_OVERRIDE[width] : WIDTH_BY_DEPTH[level];
  const shown = entered && !closing;

  // Portalled to <body> for the same reason Modal is: an ancestor with a
  // transform or backdrop-filter becomes the containing block for fixed
  // descendants, which would pin the drawer to that ancestor's box.
  return createPortal(
    <>
      <div
        className={`eb-overlay-backdrop fixed inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none print:hidden ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        style={{ zIndex: z.backdrop }}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Clip layer. The panel translates OUT to the right to enter and leave;
          without something clipping it, that off-screen frame makes
          document.scrollWidth > clientWidth and trips the horizontal-overflow
          assertion in e2e/layout.spec.ts. */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden print:static print:overflow-visible"
        style={{ zIndex: z.panel }}
      >
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={[
            "eb-overlay-panel pointer-events-auto absolute inset-y-0 right-0",
            "grid grid-rows-[auto_1fr_auto] w-full",
            widthClasses,
            "bg-card border-l border-border shadow-2xl outline-none",
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            shown ? "translate-x-0" : "translate-x-full",
            // A fixed panel prints as a bar stamped across page 1; the rest of
            // the print handling is the @media print block in index.css.
            "print:static print:w-full print:max-w-none print:shadow-none",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
          // React synthetic events bubble through the React tree, not the DOM,
          // so a submit inside a nested drawer would otherwise reach the parent
          // drawer's <form onSubmit> and fire an unintended save. Same reason as
          // Modal's containment — and with stacked drawers it is not theoretical.
          onSubmit={(e) => e.stopPropagation()}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="truncate text-lg font-semibold text-foreground"
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              <Button
                variant="ghost"
                size="icon"
                onClick={requestClose}
                aria-label="Close"
              >
                <XIcon size={18} aria-hidden="true" />
              </Button>
            </div>
          </header>

          {/* min-h-0 is load-bearing for the same reason AdminLayout documents
              it: a grid child defaults to min-height:auto and refuses to shrink
              below its content, which would push the footer off the bottom
              instead of scrolling. overscroll-contain stops the scroll chaining
              into the list behind once this reaches its end. */}
          <div
            className={`eb-overlay-body min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain print:overflow-visible ${
              padded ? "p-4 lg:p-5" : ""
            }`}
          >
            {children}
          </div>

          {footer ? (
            <div className="border-t border-border bg-card px-4 py-3">
              {footer}
            </div>
          ) : null}
        </aside>
      </div>
    </>,
    document.body,
  );
};

export default Drawer;
