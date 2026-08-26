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
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const SCANNED = /\.(tsx?|css)$/;

/** Utility prefixes a color token can appear behind, e.g. `hover:text-heading`. */
const PREFIXES =
  "text|bg|border|ring|divide|placeholder|from|via|to|fill|stroke|outline|decoration|accent|caret|shadow";

/** Matches `<utility>-<token>` at a class-token boundary, variants included. */
const color = (token) =>
  new RegExp(`(?<![\w-])(?:${PREFIXES})-${token}(?![\w-])`, "g");

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
    enabled: false,
    stage: "3a",
    hint: "purple-600 -> primary, purple-700 -> primary/90, purple-50/100/200 -> accent.",
    pattern: /(?<![\w-])purple-\d{2,3}(?![\w-])/g,
  },
  {
    id: "text-heading",
    enabled: false,
    stage: "3b",
    hint: "-heading -> -foreground",
    pattern: color("heading"),
  },
  {
    id: "text-body-bg-surface",
    enabled: false,
    stage: "3c",
    hint: "-body -> -muted-foreground, bg-surface -> bg-muted",
    pattern: new RegExp(
      `(?<![\w-])(?:(?:${PREFIXES})-body|(?:${PREFIXES})-surface)(?![\w-])`,
      "g",
    ),
  },
  {
    id: "legacy-radius-shadow",
    enabled: false,
    stage: "3d",
    hint: "rounded-control -> rounded-md, rounded-card -> rounded-xl, shadow-card -> shadow-sm, shadow-dropdown -> shadow-lg",
    pattern: /(?<![\w-])(?:rounded-(?:control|card)|shadow-(?:card|dropdown))(?![\w-])/g,
  },
  {
    id: "danger-token",
    enabled: false,
    stage: "3e",
    hint: "-danger / -danger-soft -> -destructive / -destructive/10",
    pattern: color("danger(?:-soft)?"),
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
const active = RULES.filter((r) => r.enabled);
const findings = new Map(active.map((r) => [r.id, []]));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const rule of active) {
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
process.exit(total > 0 ? 1 : 0);
