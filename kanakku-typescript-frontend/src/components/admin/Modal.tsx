import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XCircleIcon } from 'lucide-react';
import { confirmIfDirty } from '@hooks/useDirtyGuard';

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

// Escape must close only the topmost modal when modals nest (e.g.
// CreateProductForm's Modal with a quick-create CreateUnitModal/
// CreateCategoryModal/CreateBrandModal/CreateTaxGroupModal on top). Every open
// instance pushes its id here and the keydown handler below only acts when
// it's the last (topmost) entry — otherwise it lets the event fall through
// to whichever modal actually owns it.
const modalStack: symbol[] = [];

const Modal = ({ isOpen, onClose, title, children, size = '2xl', confirmOnClose = false }: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const idRef = useRef(Symbol('modal'));

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

    modalStack.push(idRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the topmost modal in the stack reacts — a nested modal's Escape
      // must not also bubble into an outer modal's handler.
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      handleClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Cleanup order across nested modals isn't guaranteed LIFO, so remove
      // by identity rather than assuming this is the top of the stack.
      const idx = modalStack.indexOf(idRef.current);
      if (idx !== -1) modalStack.splice(idx, 1);
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  // Render through a portal to <body> so the fixed-position overlay is always
  // anchored to the viewport. Inline rendering breaks when an ancestor creates
  // a containing block for fixed descendants (e.g. the invoice toolbar's
  // `backdrop-blur`/transform), which pins the modal to that ancestor's box and
  // leaves it off-screen / unscrollable.
  return createPortal(
    <>
      {/* Fixed Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={handleClose}></div>

      {/* Scrollable Page Flow */}
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-10">
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
              <XCircleIcon size={24} />
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
