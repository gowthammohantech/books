import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { AnimatedIcon } from '@components/icons';
import { confirmIfDirty } from '@hooks/useDirtyGuard';
import {
  isTopmostOverlay,
  overlayCount,
  overlayZ,
  pushOverlay,
  removeOverlay,
} from '@components/ui';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
  // When true, backdrop-click (and Escape, if this modal ever handles it)
  // confirms before discarding — pass the caller's own "form has unsaved
  // changes" check here (see CreateProductForm).
  confirmOnClose?: boolean;
}

const sizeClassMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  full: 'w-full max-w-none',
};

// Escape must close only the topmost overlay when overlays nest (e.g. a
// quick-create modal opened from inside a create Drawer). The stack lives in
// components/ui/overlayStack so Modal and Drawer share one — a stack private
// to this file could only see half of a mixed nest.
const Modal = ({ isOpen, onClose, title, children, size = '2xl', confirmOnClose = false }: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const idRef = useRef(Symbol('modal'));

  // Same stack-derived depth as Drawer: a confirm opened from inside a drawer
  // has to paint above it, and the two nest in both directions.
  const depthRef = useRef<number | null>(null);
  if (isOpen && depthRef.current === null) depthRef.current = overlayCount();
  if (!isOpen && depthRef.current !== null) depthRef.current = null;
  const depth = depthRef.current ?? 0;

  // Route every discard through the shared confirm so backdrop-click can't
  // silently drop a half-filled form when the caller marks it dirty.
  const handleClose = () => {
    if (!confirmIfDirty(confirmOnClose)) return;
    onClose();
  };

  // On open: remember the trigger element, move focus into the dialog (first
  // focusable descendant, falling back to the dialog container itself), and
  // wire Escape through the same confirm-guarded close path as backdrop-click.
  // On close/unmount: return focus to the trigger. No focus-trap — just the
  // quick-win in/out.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement;

    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? dialogRef.current)?.focus();

    pushOverlay(idRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the topmost overlay in the stack reacts — a nested one's Escape
      // must not also bubble into an outer overlay's handler.
      if (!isTopmostOverlay(idRef.current)) return;
      handleClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      removeOverlay(idRef.current);
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const z = overlayZ(depth);

  // Render through a portal to <body> so the fixed-position overlay is always
  // anchored to the viewport. Inline rendering breaks when an ancestor creates
  // a containing block for fixed descendants (e.g. the invoice toolbar's
  // `backdrop-blur`/transform), which pins the modal to that ancestor's box and
  // leaves it off-screen / unscrollable.
  return createPortal(
    <>
      {/* Fixed Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex: z.backdrop }}
        onClick={handleClose}
      ></div>

      {/* Scrollable Page Flow */}
      <div
        className="fixed inset-0 flex items-start justify-center overflow-y-auto px-4 py-10"
        style={{ zIndex: z.panel }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className={`w-full ${sizeClassMap[size ?? '2xl']} rounded-lg bg-white shadow-lg`}
          onClick={(e) => e.stopPropagation()}
          // React synthetic events bubble through the React tree (not the DOM),
          // so a form submit inside a portaled modal would otherwise reach an
          // ancestor page <form onSubmit> and fire an unintended save. Contain it.
          onSubmit={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h2 className="text-xl font-bold text-gray-600 font-sans">{title}</h2>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-700 cursor-pointer"
              aria-label="Close modal"
            >
              <AnimatedIcon name="close-circle" size={24} />
            </button>
          </div>

          {/* Body */}
          <div className="p-4">{children}</div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default Modal;
