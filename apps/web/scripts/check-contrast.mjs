#!/usr/bin/env node
/**
 * Asserts the palette's contrast promises.
 *
 * index.css carries a comment block claiming measured ratios ("warning/white
 * measured 1.87:1", "these are the shallowest darkening that reaches AA").
 * Nothing enforced it, so the numbers were only as true as the last person to
 * check them by hand — and the ERPNext migration moves every one of them.
 *
 * This resolves the tokens out of index.css the way the browser would, then
 * measures. A pair whose tokens do not exist yet is reported as pending, not
 * failed, so the table can describe the finished palette while the migration
 * is still landing. Run: npm run lint:contrast
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CSS = readFileSync(join(ROOT, "src", "index.css"), "utf8");

/** Every `--name: value;` inside the first :root block. */
function readRoot(css) {
  const start = css.indexOf(":root {");
  let depth = 0, end = start;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = css.slice(start, end);
  const vars = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim().replace(/\s*\/\*[\s\S]*?\*\/\s*/g, "").trim());
  }
  return vars;
}

const VARS = readRoot(CSS);

/** Follow var() chains to a literal. Returns null if the chain dead-ends. */
function resolve(name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = VARS.get(name);
  if (!raw) return null;
  const m = raw.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(m[1], seen) : raw;
}

function toRgb(hex) {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;        // normal-size text
const AA_LARGE = 3.0;  // large text
const NON_TEXT = 3.0;  // UI component boundaries and focus indicators

// [foreground, background, required, label, note?]
// `note` marks a pair we ship knowingly under its threshold, with the reason.
const PAIRS = [
  ["--text-color", "--card", AA, "body text on a card"],
  ["--text-color", "--background", AA, "body text on the page"],
  ["--text-muted", "--card", AA, "secondary text on a card"],
  ["--text-muted", "--control-bg", AA, "text inside a filled control"],
  ["--text-light", "--card", AA, "third-tier text (timestamps, hints)",
    "ERPNext's own --text-light. Under AA, but these sites were at 2.66:1 " +
    "before the migration, and the tier carries no unique information."],
  ["--gray-700", "--gray-50", AA, "body text on the recessed background"],
  ["--gray-950", "--surface-white", AA, "darkest ink on white"],
  ["--gray-50", "--gray-700", AA, "light text on the gray solid badge"],

  ["--primary-foreground", "--primary", AA, "primary button label"],
  ["--destructive-foreground", "--destructive", AA, "destructive button label"],
  ["--success-foreground", "--success", AA, "success fill label"],
  ["--warning-foreground", "--warning", AA, "warning fill label"],
  ["--info-foreground", "--info", AA, "info fill label"],
  ["--success-strong", "--success-soft", AA, "success soft badge"],
  ["--warning-strong", "--warning-soft", AA, "warning soft badge"],
  ["--info-strong", "--info-soft", AA, "info soft badge"],
  ["--destructive-strong", "--destructive-soft", AA, "destructive soft badge"],

  ["--ring", "--card", NON_TEXT, "focus ring on a card"],
  ["--ring", "--control-bg", NON_TEXT, "focus ring on a filled control"],
  ["--outline-gray-1", "--surface-white", 1.0, "hairline rule on white"],
  ["--accent-foreground", "--accent", AA, "text on the brand tint"],
  ["--primary", "--accent", AA, "brand text on the brand tint"],

  // Tinted pairs — the ERPNext status primitive. Land in the stage that adds them.
  ...["green", "red", "blue", "orange", "yellow", "purple", "pink", "cyan",
      "teal", "violet", "amber", "gray"].map((h) => [
    `--text-on-${h}`, `--bg-${h}`, AA, `${h} indicator pill`,
  ]),
];

let failed = 0, passed = 0, pending = 0, noted = 0;
const rows = [];

for (const [fgName, bgName, need, label, note] of PAIRS) {
  const fgHex = resolve(fgName), bgHex = resolve(bgName);
  if (!fgHex || !bgHex) {
    pending++;
    rows.push(["pend", label, `${fgName} / ${bgName}`, "-", "not defined yet"]);
    continue;
  }
  const fg = toRgb(fgHex), bg = toRgb(bgHex);
  if (!fg || !bg) {
    pending++;
    rows.push(["pend", label, `${fgName} / ${bgName}`, "-", "non-hex value"]);
    continue;
  }
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (ok) passed++;
  else if (note) noted++;
  else failed++;
  rows.push([
    ok ? "ok" : note ? "note" : "FAIL",
    label,
    `${fgHex} on ${bgHex}`,
    `${r.toFixed(2)}:1`,
    ok ? `needs ${need}` : note ?? `needs ${need}`,
  ]);
}

const w = (s, n) => String(s).padEnd(n);
for (const [status, label, colors, r, extra] of rows) {
  if (status === "ok") {
    console.log(`  ok    ${w(label, 38)} ${w(colors, 22)} ${r}`);
  } else if (status === "pend") {
    console.log(`  pend  ${w(label, 38)} ${extra}`);
  } else if (status === "note") {
    console.log(`\n  NOTE  ${label} — ${colors} is ${r}`);
    console.log(`        ${extra}\n`);
  } else {
    console.log(`\n  FAIL  ${label} — ${colors} is only ${r}, ${extra}\n`);
  }
}

console.log(
  `\n  ${passed} pass, ${noted} known deviation(s), ${failed} fail, ${pending} pending\n`,
);
process.exit(failed > 0 ? 1 : 0);
