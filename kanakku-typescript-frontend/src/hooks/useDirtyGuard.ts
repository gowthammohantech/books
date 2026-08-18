import { useEffect } from 'react';

// A single confirm message shared by every discard path (tab close, page
// Cancel buttons, modal backdrop/Escape) so the user sees one consistent
// prompt no matter how they try to leave a half-filled form.
const CONFIRM_MESSAGE = 'Discard unsaved changes?';

/**
 * Ask the user to confirm before discarding unsaved changes.
 *
 * Returns `true` when it's safe to proceed (the form isn't dirty, or the user
 * confirmed the discard) and `false` when the caller should stay put. Use
 * this in Cancel buttons and Modal's `confirmOnClose` so every discard path
 * shares the same prompt.
 */
export const confirmIfDirty = (isDirty: boolean): boolean => {
  if (!isDirty) return true;
  return window.confirm(CONFIRM_MESSAGE);
};

/**
 * Warn before an unsaved form gets discarded.
 *
 * ROUTER CONSTRAINT: this app mounts a plain `<BrowserRouter>` in
 * `src/main.tsx`, not a data router (`createBrowserRouter` + `RouterProvider`).
 * react-router's `useBlocker` only works inside a data router — calling it
 * here would throw. Migrating the router is out of scope for this task, so
 * this hook can only guard:
 *   - Tab close / refresh / external navigation, via `beforeunload`.
 *   - The page's own Cancel button, via the exported `confirmIfDirty` helper
 *     (wire it into the button's onClick before navigating).
 *
 * In-app navigation that doesn't go through a wired Cancel button (sidebar
 * links, browser back/forward, other in-app `<Link>`s) is NOT intercepted —
 * there is no supported way to hook that outside a data router.
 */
export function useDirtyGuard(isDirty: boolean): void {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      // Chrome requires returnValue to be set to show the native prompt.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);
}
