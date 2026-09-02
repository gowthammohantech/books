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
