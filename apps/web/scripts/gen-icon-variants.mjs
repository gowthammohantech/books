#!/usr/bin/env node
/**
 * Generates the animated icon variants from lucide's own geometry.
 *
 * WHY GENERATE. A variant is lucide's path data wrapped in motion components.
 * Hand-transcribing that data is the one part a human reliably gets wrong: a
 * dropped digit in a 200-character `d` string is a silently broken glyph that
 * only ever shows up as "the icon looks slightly off". pqoqubbw's own copies
 * have already drifted from lucide 0.525 this way — its `bell` is the previous
 * lucide bell, and its `delete` is a trash can where lucide's `Delete` is a
 * backspace key. Reading __iconNode straight out of node_modules makes the
 * animated icon identical to the static one BY CONSTRUCTION, so the hover swap
 * cannot pop. variants.parity.test.ts then guards the committed output against
 * a lucide bump that lands without a regeneration.
 *
 * What is authored by hand is the SPEC below: which parts of each glyph move,
 * and how. That is the design decision. The coordinates are not.
 *
 * Run: npm run gen:icons
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LUCIDE = join(ROOT, "../../node_modules/lucide-react/dist/esm/icons");
const OUT = join(ROOT, "src/components/icons/variants");

/**
 * name     the semantic registry key (iconRegistry.ts)
 * lucide   the kebab-case lucide icon to take geometry from
 * svg      a variant applied to the whole mark
 * origin   transform-origin for that variant, when the centre is wrong
 * draw     node indices that draw themselves in
 * stagger  node indices that enter in sequence, in the order listed
 *
 * Node indices refer to lucide's __iconNode order. A lucide bump that reorders
 * nodes would silently animate the wrong part of a glyph — which is one of the
 * things variants.parity.test.ts is watching for.
 */
const SPEC = [
  // --- Nav modules ---------------------------------------------------------
  // The door swings open on the house.
  { name: "dashboard", lucide: "house", draw: [0] },
  // The bag's handle draws itself.
  { name: "purchases", lucide: "shopping-bag", draw: [0] },
  // The carton's seams draw in, so the box reads as being packed.
  { name: "inventory", lucide: "box", draw: [1, 2] },
  // The figures write themselves onto the slip.
  { name: "sales", lucide: "receipt", draw: [1, 2] },
  // The second person arrives.
  { name: "contacts", lucide: "users", draw: [1, 2] },
  // The bank's columns rise, outside pair first.
  { name: "accounts", lucide: "landmark", stagger: [5, 0, 2, 3] },
  // The slash strikes through.
  { name: "taxation", lucide: "percent", draw: [0] },
  // Storeys light up floor by floor.
  { name: "fixed-assets", lucide: "building-2", stagger: [3, 4, 5, 6] },
  // Bars grow left to right, shortest first.
  { name: "reports", lucide: "chart-no-axes-column", stagger: [2, 1, 0] },
  // The case's handle draws in.
  { name: "payroll", lucide: "briefcase", draw: [0] },
  // The tick lands on the shield.
  { name: "audit-trail", lucide: "shield-check", draw: [1] },
  // The tick lands on the clipboard.
  { name: "approvals", lucide: "clipboard-check", draw: [2] },
  // The small sparks twinkle around the big one.
  { name: "ai-extractions", lucide: "sparkles", stagger: [1, 2, 3, 4] },

  // --- Shell chrome --------------------------------------------------------
  // Pivots at the crown, like a real bell.
  { name: "bell", lucide: "bell", svg: "SWING", origin: "50% 15%" },
  { name: "settings", lucide: "settings", svg: "SPIN_HALF" },
  // The lens pops and the handle draws out of it.
  { name: "search", lucide: "search", svg: "POP", draw: [0] },
  { name: "chevron-right", lucide: "chevron-right", svg: "NUDGE_X" },
  { name: "plus", lucide: "plus", svg: "SPIN_HALF" },
  // The pair swap IS the morph; each half just redraws its own arrow.
  { name: "panel-close", lucide: "panel-left-close", draw: [2] },
  { name: "panel-open", lucide: "panel-left-open", draw: [2] },

  // --- Table & modal chrome ------------------------------------------------
  // Highest-volume icon in the app: one on every table row.
  { name: "more-vertical", lucide: "ellipsis-vertical", stagger: [1, 0, 2] },
  { name: "close-circle", lucide: "circle-x", draw: [1, 2] },
  // The bin's contents draw in; the lid stays put so it still reads as a bin.
  { name: "trash", lucide: "trash-2", draw: [3, 4] },
  { name: "edit", lucide: "square-pen", draw: [1] },
  { name: "download", lucide: "download", svg: "NUDGE_Y", draw: [2] },
  { name: "refresh", lucide: "refresh-cw", svg: "SPIN" },
  { name: "trend-up", lucide: "arrow-up-right", draw: [1] },
  { name: "trend-down", lucide: "arrow-down-left", draw: [0] },
];

/** Pull lucide's __iconNode array out of its ESM source, as data. */
function iconNode(kebab) {
  const text = readFileSync(join(LUCIDE, `${kebab}.js`), "utf8");
  const match = text.match(/__iconNode\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error(`no __iconNode in ${kebab}.js`);
  // The source is a JS literal with unquoted keys, so evaluate it rather than
  // hand-rolling a parser. The input is our own node_modules, not user data.
  return new Function(`return ${match[1]}`)();
}

const attrs = (props) =>
  Object.entries(props)
    .filter(([key]) => key !== "key")
    .map(([key, value]) => `${key}={${JSON.stringify(String(value))}}`)
    .join(" ");

const pascal = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());

function generate(spec) {
  const nodes = iconNode(spec.lucide);
  const draw = new Set(spec.draw ?? []);
  const staggered = spec.stagger ?? [];

  const children = nodes.map(([tag, props], i) => {
    const a = attrs(props);
    if (draw.has(i)) {
      return `                <motion.${tag} ${a} variants={DRAW} animate={state} transition={DEFAULT_TRANSITION} />`;
    }
    const at = staggered.indexOf(i);
    if (at !== -1) {
      return `                <motion.${tag} ${a} variants={stagger(${at})} animate={state} style={SELF_BOX} />`;
    }
    return `                <${tag} ${a} />`;
  });

  const imports = ["SVG_BASE"];
  if (draw.size) imports.push("DRAW", "DEFAULT_TRANSITION");
  if (staggered.length) imports.push("stagger", "SELF_BOX");
  if (spec.svg) imports.push(spec.svg, "DEFAULT_TRANSITION");

  const Root = spec.svg ? "motion.svg" : "svg";
  const rootMotion = spec.svg
    ? `\n                variants={${spec.svg}}\n                animate={state}\n                transition={DEFAULT_TRANSITION}`
    : "";
  const originStyle = spec.origin
    ? `\n                style={{ transformOrigin: ${JSON.stringify(spec.origin)} }}`
    : "";
  const Name = pascal(spec.name);

  return `/**
 * ${Name} — generated by scripts/gen-icon-variants.mjs from lucide-react's
 * \`${spec.lucide}\`. Do not edit by hand: run \`npm run gen:icons\`.
 *
 * The geometry is lucide's, verbatim, so this is pixel-identical to the static
 * icon at rest. The motion recipes come from variants/shared.ts.
 */
import { motion } from "motion/react";
import { forwardRef } from "react";

import { ${[...new Set(imports)].sort().join(", ")} } from "./shared";
import type { AnimatedIconVariantProps } from "./types";

const ${Name} = forwardRef<SVGSVGElement, AnimatedIconVariantProps>(
    function ${Name}({ size = 24, state, ...rest }, ref) {
        return (
            <${Root}
                ref={ref}
                {...SVG_BASE}
                width={size}
                height={size}${rootMotion}${originStyle}
                {...rest}
            >
${children.join("\n")}
            </${Root}>
        );
    },
);

export default ${Name};
`;
}

// Drop stale files, so a name removed from SPEC cannot linger and desync the
// registry manifest that iconRegistry.test.ts compares against.
const keep = new Set(SPEC.map((s) => `${s.name}.tsx`));
for (const file of readdirSync(OUT)) {
  if (file.endsWith(".tsx") && !keep.has(file)) unlinkSync(join(OUT, file));
}

for (const spec of SPEC) {
  writeFileSync(join(OUT, `${spec.name}.tsx`), generate(spec), "utf8");
}

const importLines = SPEC.map((s) => `import ${pascal(s.name)} from "./${s.name}";`).join("\n");
const entries = SPEC.map((s) => `    "${s.name}": ${pascal(s.name)},`).join("\n");

writeFileSync(
  join(OUT, "index.ts"),
  `${importLines}
import type { VariantMap } from "./loader";

/**
 * The lazy chunk root. Everything reachable from here — \`motion/react\`
 * included — is code-split out of the initial bundle, which is enforced by the
 * \`motion-outside-chunk\` rule in scripts/check-legacy-tokens.mjs.
 *
 * Generated by scripts/gen-icon-variants.mjs. Do not edit by hand.
 */
export const ANIMATED_VARIANTS: VariantMap = {
${entries}
};
`,
  "utf8",
);

console.log(`  generated ${SPEC.length} variants into src/components/icons/variants/`);
