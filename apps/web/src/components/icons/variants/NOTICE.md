# Animated icon variants — attribution

## Motion recipes — pqoqubbw/icons (MIT)

The animation vocabulary in `shared.ts` (`DRAW`, `SWING`, `stagger`, and the
per-icon choices of which part of a glyph moves) is adapted from
[pqoqubbw/icons](https://github.com/pqoqubbw/icons), MIT licensed.

What we changed, and why:

- **No wrapper `<div>`.** Upstream components return a `<div>` around the
  `<svg>` carrying the hover handlers. That is invalid inside `<button>` (which
  is where `Button`'s `leftIcon` renders) and inside `<p>` (`SettingsLayout`),
  where the parser silently auto-closes the paragraph. Ours render the bare
  `<svg>` and take the trigger from an ancestor instead — see `useIconTrigger`.
- **No `useAnimation` / `useImperativeHandle`.** Those are value imports from
  `motion/react`; calling them in the seam would pull the whole library into the
  initial bundle. State arrives as a `state` prop, so every `motion` import
  stays inside this lazily-loaded directory.
- **Geometry replaced.** Upstream is not pinned to the lucide version this app
  uses. Its `bell` is the previous lucide bell, its `receipt` is a newer one,
  and its `delete` is a trash can where lucide's `Delete` is a backspace key.
  Since these icons swap in on hover over the static lucide glyph, any drift
  shows up as a visible pop. All geometry is therefore read from the installed
  `lucide-react` at generation time — see `scripts/gen-icon-variants.mjs` — and
  held there by `variants.parity.test.ts`.
- **No `"use client"`.** This is a Vite SPA, and the directive only makes Rollup
  warn.

## Glyph geometry — lucide (ISC)

All path data is from [lucide](https://github.com/lucide-icons/lucide),
ISC licensed, via the `lucide-react` package already in this project's
dependencies.
