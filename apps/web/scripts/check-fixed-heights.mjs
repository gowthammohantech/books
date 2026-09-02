#!/usr/bin/env node
/**
 * Guards the fixed-height migration.
 *
 * The app was unusable at 100% browser zoom because content blocks asserted
 * pixel heights inside a viewport-locked shell (`flex h-screen` → a single
 * `overflow-y-auto` pane). A fixed height is invisible in review — it renders
 * fine on the author's monitor and only fails on a shorter viewport — so this
 * holds the migration in place the way check-legacy-tokens.mjs holds the token
 * one. Same shape: rules carry `enabled`/`stage`/`hint`, and a stage is done
 * when its rule is enabled and this reports zero.
 *
 * The browser-side companion (scripts/audit-layout.mjs, run by e2e/layout.spec.ts)
 * catches what static text cannot: heights injected at runtime by chart
 * libraries. This catches what the browser cannot: a fixed height on a route
 * nobody screenshotted. Run: npm run lint:layout
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const SCANNED = /\.(tsx?|css)$/;

const RULES = [
  {
    id: "arbitrary-px-height",
    enabled: true,
    stage: "H1",
    hint:
      "Fixed px height. Use clamp(min, vh, max), an aspect-ratio box, or let " +
      "flex sizing drive it. A 600px block does not fit an 824px pane once a " +
      "header and a table are also on screen.",
    pattern: /(?<![\w-])(min-|max-)?h-\[(\d+)px\]/g,
    // A `min-height` reserves space unconditionally, so it bites at a lower
    // value than a `height` does; below these it is control sizing, not layout.
    filter: (m, line) => {
      // A max-height that caps an already-responsive height is good practice,
      // not a fixed height — e.g. `h-[50vw] max-h-[500px]` on a decorative
      // blob. Only flag the cap when nothing else on the element is fluid.
      if (m[1] === "max-" && /\b(?:min-|max-)?h-\[[^\]]*(?:vh|vw|dvh|svh|%|clamp\()/.test(line)) {
        return false;
      }
      return Number(m[2]) >= (m[1] === "min-" ? 120 : 200);
    },
  },
  {
    id: "large-scale-height",
    enabled: true,
    stage: "H1",
    hint:
      "Tailwind scale height >= 208px (h-52 and up). Same problem as an " +
      "arbitrary px height, just spelled with the scale.",
    pattern: /(?<![\w-])(?:min-|max-)?h-(?:5[2-9]|[6-9]\d|1\d\d)(?![\w-])/g,
  },
  {
    id: "chart-px-height",
    enabled: true,
    stage: "H2",
    hint:
      "Chart height as a px literal. Wrap in <ChartFrame> and pass the measured " +
      "height — ApexCharts only auto-resizes on window.resize, so a fixed height " +
      "is also why charts go stale when the sidebar or agent dock toggles.",
    pattern: /height=\{\s*\d{3,}\s*\}|height="\d{3,}(?:px)?"/g,
  },
  {
    id: "css-fixed-height",
    enabled: true,
    stage: "H2",
    hint: "Fixed height in a stylesheet. Use clamp() so it collapses on short viewports.",
    // Only in .css; the JS-side equivalents are covered above.
    pattern: /^\s*(?:min-)?height:\s*\d{3,}px\s*;/gm,
    onlyIn: /\.css$/,
  },
  {
    id: "page-level-viewport-height",
    // Staged, not yet enforced. The create flows are clean — they are drawers
    // now and the drawer body sizes itself — but the six Edit twins still
    // carry the frame the create screens used to
    // (`md:p-4 min-h-screen border border-gray-200 rounded`, e.g.
    // EditInvoice.tsx:1326), and Reminder.tsx uses min-h-screen for three
    // hand-rolled modal wrappers. Enable this once those land; until then it
    // reports under --all so the remaining debt is countable.
    enabled: false,
    stage: "H3",
    hint:
      "min-h-screen / h-screen on a page root. AdminLayout is `flex h-dvh` with " +
      "one overflow-y-auto pane, and a Drawer body is shorter still — a " +
      "viewport-height floor inside either guarantees a scrollbar even when " +
      "the content fits. The shell owns the pane height.",
    pattern: /(?<![\w-])(?:min-)?h-screen(?![\w-])/g,
    // auth/ renders outside the admin shell and legitimately owns the viewport;
    // AgentDock's `lg:h-screen` is a static sibling column, not a page root.
    onlyIn: /^apps\/web\/src\/pages\/admin\/(?!auth\/)/,
  },
  {
    id: "inline-style-px-height",
    enabled: true,
    stage: "H2",
    hint: "Inline px height in a style object. Same fix as the class form.",
    pattern: /\b(?:height|minHeight|maxHeight):\s*['"]?(\d+)(?:px)?['"]?(?![\d%a-z])/g,
    onlyIn: /\.tsx?$/,
    filter: (m) => Number(m[1]) >= 200,
    // brandLogo.ts is image-crop arithmetic against a fixed source bitmap, and
    // the print templates are physical paper sizes — neither is a viewport.
    allowIn: /^apps\/web\/src\/(utils\/brandLogo\.ts|components\/print\/|pages\/admin\/invoices\/(EmailInvoice|InvoiceTemplateA5Landscape)\.tsx)/,
  },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (SCANNED.test(e.name)) yield p;
  }
}

const files = [...walk(SRC)];
const SHOW_ALL = process.argv.includes("--all");
const active = RULES.filter((r) => r.enabled || SHOW_ALL);
const findings = new Map(active.map((r) => [r.id, []]));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const rel = `apps/web/${relative(ROOT, file).split(sep).join("/")}`;
  for (const rule of active) {
    if (rule.allowIn?.test(rel)) continue;
    if (rule.onlyIn && !rule.onlyIn.test(rel)) continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace("m", ""));
    lines.forEach((line, i) => {
      const hits = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        if (m[0] === "") { re.lastIndex++; continue; }
        if (!rule.filter || rule.filter(m, line)) hits.push(m[0]);
      }
      if (hits.length) {
        findings.get(rule.id).push({ file: relative(ROOT, file), line: i + 1, hits: [...new Set(hits)] });
      }
    });
  }
}

let total = 0;
for (const rule of active) {
  const hits = findings.get(rule.id);
  const count = hits.reduce((n, h) => n + h.hits.length, 0);
  total += count;
  if (!count) {
    console.log(`  ok   [stage ${rule.stage}] ${rule.id}`);
    continue;
  }
  console.log(`\n  FAIL [stage ${rule.stage}] ${rule.id} — ${count} in ${hits.length} place(s)`);
  console.log(`       ${rule.hint}`);
  for (const h of hits.slice(0, 25)) {
    console.log(`       ${h.file}:${h.line}  ${h.hits.join(", ")}`);
  }
  if (hits.length > 25) console.log(`       … and ${hits.length - 25} more`);
}

console.log(`\n  scanned ${files.length} files, ${active.length} rule(s) active, ${total} violation(s)\n`);
process.exit(!SHOW_ALL && total > 0 ? 1 : 0);
