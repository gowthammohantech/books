# UI density audit — why the app only looked right at 80% zoom

Companion to the layout fix. Records what was measured, what was changed, and
what was deliberately left alone.

## Summary of the diagnosis

The app was reported as unusable at 100% browser zoom: users set Chrome to
75–80% before the UI "looked right". It is not a typography problem — body text
is 12–14px, already at or below the reference app's 13–14px.

The real cause is three compounding things:

1. **Fixed pixel heights inside a viewport-locked shell.** The root is
   `flex h-screen` (`AdminLayout.tsx:77`) with one `flex-1 overflow-y-auto p-4`
   pane. The dashboard needs ~1371px of content height; a 1461×878 window gives
   the pane ~824px. At 80% zoom the viewport grows to ~1100px and the fixed
   blocks finally fit — which is the whole reason 80% "looks right".
2. **No responsive tier above `lg`.** `xl:` appeared 4 times in the entire app
   and `2xl:` zero times, with no max-width container, so above 1024px nothing
   changed except cards getting wider.
3. **No hit-target floor.** `Button size="sm"` rendered at ~30px, already under
   the 32px minimum, and there was no `(pointer: coarse)` handling at all.

## Corrections to the original brief

Recorded because they changed the shape of the work:

| Brief said | Actually |
|---|---|
| "~804 hard px literals vs ~110 rem"; "nothing scales with root font-size" | ~345 px vs ~134 rem, of which only ~60 px literals are dimensional. This is **Tailwind v4 CSS-first** — `p-4` already compiles to `calc(var(--spacing) * 4)` with `--spacing: 0.25rem`, so the bulk of the UI was *already* rem-based and root-font-size-driven. |
| "there is already a `(pointer: coarse)` media query — respect it" | There is none. The only `@media` in the UI source was `prefers-reduced-motion`. It had to be added. |
| Audit script must report `oversized: []` | Not satisfiable as written. `getComputedStyle(el).height` returns a *used* value, always in px, so the check flags every element taller than 200px — i.e. every table and every form. Replaced by `scripts/audit-layout.mjs`, which reads the cascade (author stylesheets + inline styles) and then confirms empirically by forcing `height:auto` and re-measuring. |
| Type scale is the floor at 12px | Confirmed — text was **not** shrunk. All recovered space comes from heights, spacing and layout. |

## Tooling added

| File | Purpose |
|---|---|
| `apps/web/scripts/check-fixed-heights.mjs` | Static guard (`npm run lint:layout`), modelled on the existing `check-legacy-tokens.mjs`. Catches a fixed height on a route nobody screenshotted. |
| `apps/web/scripts/audit-layout.mjs` | Browser-side audit. Catches heights injected at runtime by chart libraries, which static text cannot see. |
| `apps/web/e2e/layout.spec.ts` | Drives all static routes at 5 viewports against a real API and demo-seeded database, recording metrics and screenshots. |

## Audit table — vertical dimensions

High priority = a vertical dimension ≥ 200px. Every row below is one.

### Charts (largest single bucket: 2 × 260px on the dashboard alone)

| File | Line | Was | Now |
|---|---|---|---|
| `pages/admin/AdminDashboard.tsx` | 405 | `<Chart height={260}>` (bar) | `<ChartFrame>` → measured height, `clamp(10rem, 22vh, 16.25rem)` |
| `pages/admin/AdminDashboard.tsx` | 561 | `height={260} width={260}` (radialBar) | `<ChartFrame aspect={1}>` → square, column-bounded |
| `pages/admin/finance-and-accounting/Banking.tsx` | 240 | `height={300}` | `<ChartFrame>` |
| `components/admin/MultiLineAreaChart.tsx` | 76 | `height={300}` | `<ChartFrame>` |
| `components/admin/ai/AiUsageChart.tsx` | 139 | wrapper `h-64` + `ResponsiveContainer` | `<ChartFrame>`; Recharts container finally gets a fluid parent |
| `components/admin/ChartCard.tsx` | 29 | `w-20 h-12` sparkline | unchanged — 48px does not need an observer |

`ChartFrame` also fixes a latent bug: ApexCharts only auto-resizes on
`window.resize`, so collapsing the sidebar (`w-60`↔`w-16`) or opening the agent
dock (a `lg:w-[420px]` sibling column) left every chart at its old width.

### Authored fixed heights

| File | Line | Was | Now |
|---|---|---|---|
| `pages/admin/finance-and-accounting/ExpenseView.tsx` | 214 | `h-[600px]` | `h-[clamp(20rem,60vh,45rem)]` |
| `index.css` (`.ProseMirror`) | 383 | `min-height: 250px` | `clamp(8rem, 22vh, 15.625rem)` |
| `components/admin/QuillEditor.tsx` | 16, 62 | default `'200px'` + `minHeight:'200px'` | clamp default; `height` prop still honoured |
| `settings/systemSettings/Reminder.tsx` | 1589, 1858, 2227 | `height="300px"` | clamp |
| `settings/systemSettings/reminders/QuotationReminderModal.tsx` | 466 | `height="300px"` | clamp |
| `components/admin/ContactPicker.tsx` | 260 | `max-h-72` (288px) | `max-h-[min(18rem,40vh)]` |
| `components/common/ImageCropperUpload.tsx` | 195 | `h-72` (288px) | aspect-ratio box |
| `pages/admin/productAndServices/ViewProduct.tsx` | 90, 153 | `h-64`, `max-h-56` | aspect-ratio / viewport-bounded |
| `pages/admin/finance-and-accounting/ReconciliationList.tsx` | 282 | `max-h-60` (240px) | `max-h-[min(15rem,35vh)]` |


### Deliberately not changed

| Item | Why |
|---|---|
| `utils/brandLogo.ts` | Crop arithmetic against a fixed source bitmap, not CSS. |
| `components/print/ThermalReceipt.tsx` (58/80mm), `InvoiceTemplateA5Landscape.tsx` (`200mm`) | Physical paper sizes. A receipt roll is not a viewport. |
| The 11 `h-48` signature pads (`canvasProps={{ className: 'w-full h-48' }}`) in the invoice / quotation / purchase / credit-note / challan forms | Initially slated for a clamp, on the assumption they were notes & terms textareas. They are `<canvas>` elements: react-signature-canvas maps CSS pixels to the backing bitmap, so a clamped height desyncs the pen from the cursor. They are also 192px, under the 200px threshold, and a signature needs room to be drawn. Left alone. |
| `max-h-48` on the product dropdown (`InvoiceTableRow.tsx`), `CustomFieldForm.tsx`, `FixedAssets.tsx` | Already the correct pattern — a `max-h` cap on a scrollable list is what a dropdown should do. |
| `pages/admin/invoices/EmailInvoice.tsx` | px inside emailed HTML strings — email clients need them. |
| `--shadow-*` offsets, 1px borders | Hairlines must stay physical. |
| `pages/errors/NotFound.tsx` | Already `vw`-based; only the caps were trimmed. |
| `grid-cols-1 lg:grid-cols-2` (28), `md:grid-cols-2` (25), `sm:grid-cols-6` (9) | Paired form columns and field-span grids. `auto-fit` would break them. |

## Measured baseline

Captured by `npm run test:layout` against the demo-seeded database, before any
change. 139 static routes × 5 viewports = 650 records
(`apps/web/e2e/__artifacts__/baseline/metrics.json`).

| Viewport | Routes | Horizontal overflow | Mean `overflowRatio` |
|---|---|---|---|
| 1366×768 | 130 | 0 | 1.183 |
| 1461×878 | 130 | 0 | 1.119 |
| 1920×1080 | 130 | 0 | 1.057 |
| 2560×1440 | 130 | 0 | 1.022 |
| 1024×1366 (touch) | 130 | 2 | 1.030 |

`overflowRatio` is `main.scrollHeight / main.clientHeight` — 1.0 means the
screen fits, 2.0 means it is twice as tall as the pane.

**The dashboard, measured:**

| Viewport | Content height | Pane height | Ratio |
|---|---|---|---|
| 1366×768 | 1775px | 715px | **2.48** |
| 1461×878 | 1717px | 825px | **2.08** |
| 1920×1080 | 1717px | 1027px | 1.67 |
| 2560×1440 | 1717px | 1387px | 1.24 |

The brief estimated ~1371px of dashboard content. The measured figure is
**1717px** — the problem was worse than reported.

Three things the baseline changes about the plan:

- **Horizontal overflow was never the problem.** Two occurrences in 650, both on
  the touch profile. The brief's "no horizontal overflow at 1366px" was already
  true. Vertical fit is the whole bug.
- **Hit targets are the most systemic defect: 646 of 650** route×viewport
  records contain at least one control below the 32px floor, across 128 distinct
  class signatures. This was not in the brief's diagnosis at all.
- **The worst screens are not the dashboard.** `/settings/transaction-categories`
  measured 5.06 and `/settings/company-settings` 3.33 at 1366×768.

## Result

Same harness, same database, after the change. 645 paired route × viewport
records (`apps/web/e2e/__artifacts__/candidate/metrics.json`).

| Viewport | Mean ratio before → after | Improved | Worse | Routes that fit before → after |
|---|---|---|---|---|
| 1366×768 | 1.193 → 1.165 | 37 | 3 | 89 → **92** |
| 1461×878 | 1.128 → 1.110 | 26 | 3 | 100 → **104** |
| 1920×1080 | 1.066 → 1.059 | 17 | 3 | 110 → **113** |
| 2560×1440 | 1.029 → 1.028 | 12 | 3 | 114 → 113 |
| 1024×1366 (touch) | 1.038 → 1.046 | 11 | 5 | 113 → 113 |

Machine checks, all viewports:

| Check | Before | After |
|---|---|---|
| Authored fixed heights | 10 | **0** |
| Sub-floor hit targets | 646 | **0** |
| Horizontal page overflow | 2 | **1** |
| `npm run lint:layout` | 19 | **0** |

The mean barely moves because most routes already fit — the work is
concentrated on the screens that were broken:

| Route | Viewport | Content height | Ratio |
|---|---|---|---|
| `/dashboard` | 1366×768 | 1775 → **1470** | 2.48 → 2.03 |
| `/dashboard` | 1461×878 | 1717 → **1405** | 2.08 → 1.68 |
| `/banking` | 1366×768 | 904 → **747** | 1.26 → **1.03** |
| `/settings/company-settings` | 1366×768 | 2400 → 2273 | 3.33 → 3.13 |
| `/accounting/reports/trial-balance` | 1366×768 | 1937 → 1832 | 2.71 → 2.53 |
| `/contacts/new` | 1366×778 | 1652 → 1543 | 2.31 → 2.13 |
| `/settings/ai` | 1366×768 | 1021 → 905 | 1.42 → 1.25 |

The remaining `/products` overflow at 1024×1366 is pre-existing and unrelated
to density; `/settings/bank-accounts` was the other one and is fixed by the
missing `min-w-0`.

### Every regression has one cause

Three routes got taller: `/reports`, `/accounting/chart-of-accounts` and
`/settings/transaction-categories`. All three are button-dense lists, and all
three grew for the same reason — the 32px hit-target floor.

Measured on `/reports` at 1461×878 by suppressing the floor at runtime:

| | Content height |
|---|---|
| Baseline (controls under 32px) | 1382 |
| After, floor suppressed | **1304** |
| After, floor active | 1559 |

So the layout work made that page 78px shorter, and the accessibility floor
added 255px on 41 button rows. Table rows measure 40.1px with the floor and
35.3px without: a row containing a 32px control cannot be shorter than 32px.

This is the brief's own constraint ("interactive controls stay ≥ 32px tall")
doing its job, and it is not something to undo. `/settings/transaction-categories`
renders 75 rows at once and `/reports` 41 — the real fix for those is
pagination, which is a behavioural change and out of scope here.

### Screens that still cannot fit at 1461×878

- **`/dashboard`** (ratio 1.68). It carries a 4-tile KPI row, an agent digest,
  4 work-queue tiles, 2 charts, a 10-row table and 3 summary panels. All of the
  KPI row, the digest, the queues and both charts are now above the fold; the
  table below is meant to be scrolled to. Fitting the rest would mean removing
  content, not sizing it.
- **`/settings/company-settings`** (2.72) and **`/settings/transaction-categories`**
  (4.51). Long single-column forms and a 75-row list. Both need
  sectioning or pagination, not density.
- **`/accounting/reports/trial-balance`** (2.19) and other ledger reports. A
  full trial balance is inherently longer than a screen.

### Verification

- `npm run lint:layout` — static fixed-height guard, 0 violations.
- `npm run test:layout` — 139 routes × 5 viewports against the real API.
- Print: with `print:block print:h-auto print:overflow-visible` preserved, the
  shell renders `display: block`, `height: auto` (1469px), `overflow: visible`,
  with the sidebar and header not rendered.
- Mobile 390×844: no horizontal overflow, 0 controls under the 44px coarse floor.
- Root font-size lever: `html { font-size: 15px }` scales sidebar width, header
  height, button height, button font size and padding all at 0.938 (= 15/16).
- `npm run test` — 263 tests pass; `typecheck` and `lint` clean (0 errors).

---

# Addendum — create flows as drawers

A later change moved every create flow into a right-side drawer. It is recorded
here because it changes what two of the numbers above *mean*, and retires one of
the defects the original audit could only work around.

## What changed

The 14 route-registered create screens and 23 create modals now render in a
shared `Drawer` (`components/ui/Drawer.tsx`): 75% of the viewport, anchored
right, sliding in right-to-left, with a header, a scrolling body and a pinned
footer. Their page frames are gone.

Family A — the eight document create screens — had each been copied from the
last, and all eight carried the same frame:

```
<div className="md:p-4 min-h-screen border border-gray-200 rounded">
  <form>
    <div className="max-w-7xl mx-auto space-y-4">
```

Three things wrong with it, all of which this audit's own findings predicted:

1. **`min-h-screen` inside an `h-dvh` shell.** A viewport-height floor in a pane
   that is already shorter than the viewport guarantees a scrollbar even when
   the content fits. It is why four create routes reported an identical 1.052 at
   2560×1440 — content *shorter* than the pane, padded back up to it.
2. **A second width cap.** `AdminLayout.tsx:93` already wraps every page in
   `max-w-(--content-max)` (105rem). `max-w-7xl` (80rem) nested inside it.
3. **A container that closed early.** The `max-w-7xl` div closed before the
   "Extra Information" grid and the footer action row, so those two blocks
   rendered full-width while everything above them was capped. Present in all
   eight; `NewDeliveryChallan.tsx` leaked six blocks. The drawer body has no
   width cap of its own, so the bug is no longer expressible.

`md:p-4` also double-padded against the shell's own `p-3 lg:p-4`.

## What this does to the metrics

**`overflowRatio` changes subject on 14 routes.** It is
`main.scrollHeight / main.clientHeight` (`scripts/audit-layout.mjs`), and a
drawer portals to `<body>`, outside `<main>`. So `/invoices/create-invoice` now
reports the ratio of the *invoice list* behind the drawer. That is not an
improvement, it is a different measurement, and the pre-drawer figures below are
not comparable with anything the sweep prints for those routes now:

| Route | 1366×768 | 1461×878 | 1920×1080 | 2560×1440 |
|---|---|---|---|---|
| `/invoices/create-invoice` | 1.846 | 1.602 | 1.290 | 1.052 |
| `/purchases/new` | 1.530 | 1.328 | 1.069 | 1.052 |
| `/quotations/new` | 1.470 | 1.277 | 1.069 | 1.052 |
| `/credit-notes/new` | 1.473 | 1.279 | 1.069 | 1.052 |
| `/contacts/new` | 2.128 | 1.848 | 1.488 | 1.105 |
| `/settings/tax-rates/new` | 1.000 | 1.000 | 1.000 | 1.000 |

`audit-layout.mjs` therefore also reports `overlay` — the topmost drawer body's
own width, height and scroll ratio — and `overlayDepth`. `layout.spec.ts` prints
those under "worst drawer-body ratios". **That** is the number that tracks the
create screens now.

**`horizontalOverflow` is the assertion this work had to be careful about.** The
panel translates fully off-screen to the right to enter and leave, and an
unclipped off-screen frame makes `document.scrollWidth > clientWidth` — a red
sweep, intermittently, depending on when the audit samples. `Drawer` renders the
panel inside a `fixed inset-0 overflow-hidden` clip layer for exactly this
reason. Measured at 1461×878 with three levels open: `scrollWidth` 1461,
`clientWidth` 1461.

**Hit targets and fixed heights are unaffected.** Both queries walk the whole
document, portalled overlays included. The drawer uses no authored heights —
`inset-y-0` plus `grid-rows-[auto_1fr_auto]` and a `min-h-0` body — so
`lint:layout` stays at zero, and the close button and footer buttons carry the
same 32/44px floors as every other control.

## Measured, in a real browser

At 1461×878, three levels open (`/_tokens`, Drawer section):

| | |
|---|---|
| Panel widths | 1096 / 1056 / 1016 px — 75%, then a constant 40px inset per level |
| Horizontal overflow | none (`scrollWidth` = `clientWidth` = 1461) |
| `#root` `inert` | set while any overlay is open, removed on the last close |
| `body[data-overlay-open]` | same |
| Escape | pops exactly one level (3 → 2 → 1 → 0) |
| Console errors | none |

## Things deliberately left as they were

| Item | Why |
|---|---|
| The 11 `h-48` signature `<canvas>` elements | Unchanged, for the reason recorded above: react-signature-canvas maps CSS pixels to the backing bitmap. Their width does change inside a drawer, so pen tracking is worth a manual check. |
| `ProductForm`'s action row | Stays in the form body rather than the drawer footer. "Create & Add Another" sets a ref the form's own submit handler reads, so hoisting it would be a behaviour change, not a layout one. |
| `Modal.tsx` | Still serves the ~44 overlays that are views, confirms and croppers. It shares `Drawer`'s overlay stack, so the two layer and unwind correctly when they nest. |
| The six `Edit*` twins | Out of scope. They still carry the frame above — see the staged `page-level-viewport-height` rule in `check-fixed-heights.mjs`, which reports 18 remaining under `--all` and is disabled until they land. |

## New guard

`check-fixed-heights.mjs` gains `page-level-viewport-height` (stage H3),
**disabled**, matching `min-h-screen` / `h-screen` under `src/pages/admin/`
excluding `auth/`. It reports 18 under `--all`: the six Edit twins' frames,
three loading spinners, and `Reminder.tsx`'s three hand-rolled modal wrappers.
None are create screens. Enable it once those are dealt with, per this file's
convention that a stage is done when its rule is on and reports zero.
