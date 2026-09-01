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

// Nothing is exempt. The compat bridge has been deleted, so a legacy class
// name no longer resolves to anything — every file must be clean.
const EXCLUDED = [];

/** Utility prefixes a color token can appear behind, e.g. `hover:text-heading`. */
const PREFIXES =
  "text|bg|border|ring|divide|placeholder|from|via|to|fill|stroke|outline|decoration|accent|caret|shadow";

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
    hint: "purple-600 -> primary, purple-700 -> primary/90, purple-50/100/200 -> accent.",
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
