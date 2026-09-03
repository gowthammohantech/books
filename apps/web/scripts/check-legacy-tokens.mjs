#!/usr/bin/env node
/**
 * Guards the design-token migration.
 *
 * Tailwind v4 removes a token without complaining: once `--color-heading` is
 * gone, `text-heading` stops emitting CSS but still compiles, renders, and
 * ships. A half-finished migration therefore looks like a slightly faded page,
 * not a build failure — and this codebase has no component tests to catch that.
 *
 * So each migration stage turns its rule on here. A stage is "done" when its
 * rule is enabled and this script reports zero. Run: npm run lint:tokens
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const SCANNED = /\.(tsx?|css)$/;

// No file is excluded from scanning. Individual rules carry their own
// `allowIn` where an exemption is real rather than convenient: the token
// gallery must render every ramp including the banned ones, and print/email
// output is outside the token system by necessity (a printed page is
// physically white; email clients strip var()).
const EXCLUDED = [];

/** Utility prefixes a color token can appear behind, e.g. `hover:text-heading`. */
const PREFIXES =
  "text|bg|border|ring|divide|placeholder|from|via|to|fill|stroke|outline|decoration|accent|caret|shadow";

/**
 * The token gallery is the reference page: its whole job is to render every
 * ramp and every variant on one screen, including the ones the app itself is
 * not allowed to reach for. Exempting it here is what keeps a blank swatch —
 * the only signal an unregistered Tailwind token gives — visible at all.
 */
const GALLERY = /^apps\/web\/src\/pages\/dev\/TokenGallery\.tsx$/;

/** Matches `<utility>-<token>` at a class-token boundary, variants included. */
const color = (token) =>
  new RegExp(String.raw`(?<![\w-])(?:${PREFIXES})-${token}(?![\w-])`, "g");

const RULES = [
  // ---- Enabled in Stage 0: things already fixed, now held fixed. ----
  {
    id: "dead-utilities",
    enabled: true,
    stage: "0",
    hint: "Not real Tailwind utilities — they render nothing.",
    pattern: /(?<![\w-])bg-white-(?:50|500)(?![\w-])/g,
  },
  {
    id: "v3-theme-fn",
    enabled: true,
    stage: "0",
    hint: "Tailwind v3 syntax. Use var(--color-*) / calc(var(--spacing) * n).",
    pattern: /\btheme\(\s*['"]/g,
  },
  {
    id: "arbitrary-hex-class",
    enabled: true,
    stage: "1",
    hint: "Arbitrary hex in a class. Use a token.",
    pattern: /(?<![\w-])(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g,
  },

  // ---- Enabled by later stages, as each migration lands. ----
  {
    id: "purple-ramp",
    enabled: true,
    stage: "3a",
    hint:
      "purple-600 -> primary, purple-700 -> primary/90, purple-50/100/200 -> accent. " +
      "The ERPNext palette does define a real purple ramp, but it is a category " +
      "tint only — reach for it through a semantic token, never as brand.",
    allowIn: GALLERY,
    // The utility prefix has to be part of the match: the character before
    // "purple" is always the "-" of "bg-"/"text-"/"ring-", which a bare
    // (?<![\w-]) lookbehind rejects — so the rule silently found nothing.
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:${PREFIXES})-purple-\d{2,3}(?![\w-])`,
      "g",
    ),
  },
  {
    id: "text-heading",
    enabled: true,
    stage: "3b",
    hint: "-heading -> -foreground",
    pattern: color("heading"),
  },
  {
    id: "text-body-bg-surface",
    enabled: true,
    stage: "3c",
    hint: "-body -> -muted-foreground, bg-surface -> bg-muted",
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:(?:${PREFIXES})-body|(?:${PREFIXES})-surface)(?![\w-])`,
      "g",
    ),
  },
  {
    id: "legacy-radius-shadow",
    enabled: true,
    stage: "3d",
    hint: "rounded-control -> rounded-md, rounded-card -> rounded-xl, shadow-card -> shadow-sm, shadow-dropdown -> shadow-lg",
    pattern: /(?<![\w-])(?:rounded-(?:control|card)|shadow-(?:card|dropdown))(?![\w-])/g,
  },
  {
    id: "legacy-brand-aliases",
    enabled: true,
    stage: "3f",
    hint: "primary-soft -> accent, primary-hover -> primary/90 (compat-bridge aliases).",
    pattern: color("primary-(?:soft|hover)"),
  },
  {
    id: "danger-token",
    enabled: true,
    stage: "3e",
    hint: "-danger / -danger-soft -> -destructive / -destructive/10",
    pattern: color("danger(?:-soft)?"),
  },

  {
    id: "gray-text-light-steps",
    enabled: true,
    stage: "E2",
    hint:
      "The ERPNext gray ramp is about one step lighter than the old one through " +
      "the middle, so these no longer carry text: gray-500 is 2.85:1 on white and " +
      "gray-400 is 1.83:1. Body text is text-gray-700 (7.81:1); the faintest text " +
      "tier is text-gray-600, which is ERPNext's own --text-light.",
    // 600 is deliberately NOT banned. It is the third tier — timestamps, hints,
    // em-dash placeholders — and measures 4.17:1, under AA for body copy. That is
    // ERPNext's shipped value and a large improvement on the 2.66:1 these sites
    // had before, but it is a real deviation: see check-contrast.mjs, which
    // records it rather than letting it pass silently.
    // `disabled:` is excluded from the variant chain. WCAG 1.4.3 exempts
    // disabled controls from contrast, and ERPNext's own disabled field is
    // #999 on #ededed — gray-500 is the faithful value there, not a mistake.
    pattern: /(?<![\w-])(?<!disabled:)(?:(?!disabled:)[a-z0-9-]+:)*text-gray-(?:400|500)(?![\w-])/g,
    allowIn: GALLERY,
  },

  {
    id: "hardcoded-control-height",
    enabled: true,
    stage: "E5",
    hint:
      "min-h-[2.25rem] and min-h-[2.5rem] are the pre-28px control heights. " +
      "Heights belong to Button's SIZES map and fieldControlClasses(); a " +
      "control that sets its own sits proud of every toolbar it lands in.",
    // Deliberately narrow. An earlier version also flagged bare h-9 / h-10,
    // which caught avatars, logos and skeletons — a rule with false positives
    // gets ignored, and then it guards nothing. Those call sites are real
    // debt (they are taller than the 28px scale, though the base-layer floor
    // keeps them legal) but sorting a control from a layout box needs eyes,
    // so they are not pretended to be covered here.
    pattern: /(?<![\w-])(?:[a-z0-9-]+:)*min-h-\[2(?:\.25|\.5)rem\](?![\w-])/g,
    // Button and FormField OWN the control heights; the literals are the point.
    allowIn:
      /^apps\/web\/src\/(?:components\/ui\/(?:Button|FormField)\.tsx|pages\/dev\/TokenGallery\.tsx)$/,
  },
  {
    id: "badge-className-override",
    enabled: true,
    stage: "E6",
    hint:
      "Pill geometry is owned by <Indicator>. A padding, radius or font-size " +
      "class on a badge is a sixth badge system starting to grow back — pass a " +
      "hue, or add a variant to Indicator.",
    pattern:
      /<(?:Badge|Indicator|StatusBadge|InvoiceStatusBadge|PaymentModeBadge|TransactionTypeBadge)\b[^>]*className=["'][^"']*(?:px-|py-|rounded-|text-\[|h-\d)/g,
    allowIn: GALLERY,
  },
  {
    id: "raw-white-black",
    // Still disabled: 7 sites remain, and all seven sit on a stock hue rather
    // than a token (violet gradient chat bubbles, avatar tints, a blue-600
    // drop zone, three group-hover fills on the petty-cash stat cards). They
    // are the same call sites stock-hue-classes below is waiting on, so the
    // two rules turn on together.
    enabled: false,
    stage: "E7",
    hint:
      "bg-white -> bg-card (a surface), bg-popover (an overlay), or " +
      "bg-surface-white (must stay white when a dark theme lands). " +
      "text-white -> the -foreground token matching its own background.",
    // bg-black/NN is deliberately allowed: a modal scrim is black at every
    // theme, and there is no token that should ever make it otherwise.
    pattern:
      /(?<![\w-])(?:[a-z0-9-]+:)*(?:(?:bg|text|border|ring|divide|from|via|to)-white|(?:text|border|ring|divide|from|via|to)-black|bg-black)(?![\w-]|\/)/g,
    // Print and email are outside the token system by necessity: a printed page
    // is physically white, and email clients strip var(). See emailPalette.
    allowIn:
      /^apps\/web\/src\/(?:pages\/admin\/[\w-]+\/\w*Template\w*\.tsx|pages\/admin\/[\w-]+\/Email\w+\.tsx|components\/print\/|components\/auth\/InvoicePaper\/|pages\/dev\/TokenGallery\.tsx)/,
  },
  {
    id: "stock-hue-classes",
    // Still disabled: 156 occurrences across 110 places. These are no longer
    // the WRONG colour — the ramps are registered at the stock hue names, so
    // bg-green-100 is already ERPNext's #e4f5e9 — they are just not semantic.
    // That is why this stage is safely deferrable: nothing looks broken while
    // it waits. Worst first: PettyCashList (hand-rolled gradient stat cards,
    // which have no ERPNext equivalent and need a design call), Banking,
    // AiChatPanel, ProfileImage (which is literally the avatar-tint primitive
    // and should move to --{hue}-avatar-bg).
    enabled: false,
    stage: "E8",
    hint:
      "Stock Tailwind hue classes. These now resolve to the ERPNext ramps, so " +
      "they are no longer the wrong colour — but status meaning belongs in " +
      "<Indicator hue>, and a raw tint belongs to bg-tint-{hue}/text-on-{hue}.",
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:${PREFIXES})-(?:red|green|blue|yellow|orange|amber|purple|violet|pink|teal|cyan|indigo|emerald|rose|sky|lime|fuchsia|slate|zinc|neutral|stone)-(?:50|100|200|300|400|500|600|700|800|900|950)(?![\w-])`,
      "g",
    ),
    allowIn: GALLERY,
  },

  // ---- Keeps the animated-icon chunk boundary honest. ----
  {
    id: "motion-outside-chunk",
    enabled: true,
    stage: "icons",
    hint:
      "`motion` may only be value-imported from components/icons/variants/. " +
      "A static import anywhere else puts ~35 kB in the initial bundle and " +
      "defeats the lazy loading. Use `import type` if you only need types.",
    // The variants directory IS the lazy chunk — motion belongs there.
    allowIn: /^apps\/web\/src\/components\/icons\/variants\//,
    pattern: /^\s*import\s+(?!type\b)[^;]*from\s+["']motion(?:\/[a-z-]+)?["']/gm,
  },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (SCANNED.test(e.name) && !EXCLUDED.some((re) => re.test(p))) yield p;
  }
}

const files = [...walk(SRC)];

// --all previews every rule, enabled or not, to size the remaining migration
// without changing which stages are being enforced.
const SHOW_ALL = process.argv.includes("--all");
const active = RULES.filter((r) => r.enabled || SHOW_ALL);
const findings = new Map(active.map((r) => [r.id, []]));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  // Posix-normalised: on Windows relative() hands back backslashes, which
  // no `allowIn` pattern would ever match.
  const rel = `apps/web/${relative(ROOT, file).split(sep).join("/")}`;
  for (const rule of active) {
    if (rule.allowIn?.test(rel)) continue;
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(text)) continue;
    lines.forEach((line, i) => {
      const m = line.match(new RegExp(rule.pattern.source, "g"));
      if (m) {
        findings
          .get(rule.id)
          .push({ file: relative(ROOT, file), line: i + 1, hits: [...new Set(m)] });
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
  for (const h of hits.slice(0, 20)) {
    console.log(`       ${h.file}:${h.line}  ${h.hits.join(", ")}`);
  }
  if (hits.length > 20) console.log(`       … and ${hits.length - 20} more`);
}

const pending = RULES.filter((r) => !r.enabled);
if (pending.length) {
  console.log(`\n  pending (enable as each stage lands): ${pending.map((r) => `${r.id}@${r.stage}`).join(", ")}`);
}

console.log(`\n  scanned ${files.length} files, ${active.length} rule(s) active, ${total} violation(s)\n`);
process.exit(!SHOW_ALL && total > 0 ? 1 : 0);
