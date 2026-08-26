import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose Tailwind class names, resolving conflicts in favour of the last one.
 *
 * The primitives in `components/ui` previously composed with a plain template
 * literal — `` `${BASE} ${VARIANTS[variant]} ${className}` `` — which appends
 * but cannot override: two conflicting utilities both survive into the class
 * attribute and the winner is decided by CSS source order, not by the order
 * the caller wrote them. So `<Button className="bg-white">` was not reliably
 * white. `cn()` drops the losing utility instead, making caller overrides
 * behave the way call sites already assume they do.
 *
 * Caveat during the token migration: tailwind-merge only knows conflicts
 * between utilities it recognises. Our transitional custom names
 * (`rounded-md`, `rounded-xl`, `shadow-sm`) are not in its group
 * table, so conflicts among those are not resolved. That resolves itself as
 * Stage 3d moves them onto the standard `rounded-*` / `shadow-*` scales.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export default cn;
