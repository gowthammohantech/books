#!/usr/bin/env node
/**
 * Fetches the empty-state illustrations and rewrites them for this app.
 *
 * The artwork is Storyset's "rafiki" set. It is committed rather than fetched
 * at runtime because this app ships a Dockerfile + nginx.conf for on-prem
 * installs, where a remote asset URL fails silently and the empty state
 * renders as a blank gap — the same reasoning that self-hosts the fonts in
 * `index.css`.
 *
 * This script is committed, and its output is committed beside it, so that:
 *
 *   - the provenance of every SVG is in the repo rather than in whoever's
 *     Downloads folder, which is what `NOTICE.md` has to be able to cite; and
 *   - a brand-colour change is a re-run, not ten hand-edited files.
 *
 * Run: node scripts/fetch-illustrations.mjs   (from apps/web)
 *
 * Four transforms are applied to each file, and each one is load-bearing —
 * see the comments on TRANSFORMS below. The result is a transparent,
 * brand-coloured, animatable subject at roughly two-thirds the source size.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src", "assets", "illustrations");

const CDN = "https://stories.freepiklabs.com/storage";

/**
 * The ten illustrations, keyed by the name `IllustrationKey` exposes.
 *
 * All are the "rafiki" variant — on storyset.com that is consistently the file
 * whose name ends `_Artboard-1`. Keep this list and `IllustrationKey` in
 * `src/utils/illustrations.ts` in step; the registry has a compile-time check
 * that every key here has a file.
 */
const ILLUSTRATIONS = {
  "no-data": "4235/64-No-data_Artboard-1",
  empty: "2191/228-Empty_Artboard-1",
  invoice: "14510/433-Invoice_Artboard-1",
  "file-searching": "1239/14-File-searching_Artboard-1",
  "people-search": "2013/179-People-search_Artboard-1",
  folder: "16529/468-Folder_Artboard-1",
  "checking-boxes": "14228/Checking-boxes_Artboard-1",
  "cash-payment": "15897/Cash-payment_Artboard-1",
  analysis: "2078/207-Analysis_Artboard-1",
  "push-notifications": "40239/413-Push-notifications_Artboard-1",
};

/** Storyset's stock accent, which every one of these files is built around. */
const STORYSET_ACCENT = /#407BFF/gi;

/** `--primary` from `src/index.css`. Kept as a literal: this is a build-time
 *  script with no DOM to read the custom property from. */
const BRAND_PRIMARY = "#3f5ec2";

/**
 * Removes `<g id="NAME"> … </g>` and everything nested inside it.
 *
 * A regex cannot match balanced tags, so this walks `<g`/`</g>` depth from the
 * opening tag and cuts at the point the depth returns to zero.
 */
const dropGroup = (svg, id) => {
  const open = new RegExp(`<g\\s+id="${id}"\\s*>`, "i").exec(svg);
  if (!open) return svg;

  let depth = 1;
  const tags = /<g\b|<\/g>/g;
  tags.lastIndex = open.index + open[0].length;

  for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
    depth += tag[0] === "</g>" ? -1 : 1;
    if (depth === 0) return svg.slice(0, open.index) + svg.slice(tag.index + tag[0].length);
  }
  return svg;
};

const transform = (svg, key) => {
  let out = svg;

  // 1. Drop both background groups.
  //
  //    `background-complete` is the baked plate of pale rectangles Storyset
  //    draws behind the subject. It is 24-39% of each file and would show as a
  //    light slab the day the dormant `.dark` block in index.css is switched
  //    on. `background-simple` is the single blob alternative, which fights
  //    whatever card the illustration is sitting on. Neither is wanted: these
  //    render inside our own surfaces, which supply their own background.
  out = dropGroup(out, "background-complete");
  out = dropGroup(out, "background-simple");

  // 2. Recolour to the brand. The accent is the one colour Storyset varies per
  //    download; skin tones (#ffb573) and the ink (#263238) stay as drawn.
  out = out.replace(STORYSET_ACCENT, BRAND_PRIMARY);

  // 3. Turn the group ids into `data-part` attributes.
  //
  //    This is what makes the artwork animatable without breaking the page.
  //    The SVGs are inlined (CSS cannot reach inside an `<img>`), so two
  //    illustrations on one screen — the dashboard has five empty cards —
  //    would put two `id="Character"` nodes in one document. Duplicate ids are
  //    invalid HTML and make `getElementById` a coin toss. Attributes carry no
  //    such constraint and CSS selects them just as cheaply.
  //
  //    Cased inconsistently at source (`Character` vs `character` in
  //    cash-payment), hence the lowercase.
  //
  //    Ids that the file refers to itself are the exception: people-search
  //    clips four groups with `clip-path="url(#clip-path)"`, and stripping
  //    those ids leaves the references dangling and the artwork unclipped.
  //    Those keep an id — namespaced with the illustration key, since two
  //    inlined files would otherwise both define `#clip-path`.
  const referenced = new Set(
    [...out.matchAll(/url\(#([^)]+)\)/g), ...out.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
  );

  out = out.replace(/\bid="([^"]+)"/g, (_, id) =>
    referenced.has(id) ? `id="${key}__${id}"` : `data-part="${id.toLowerCase()}"`,
  );

  for (const id of referenced) {
    out = out
      .split(`url(#${id})`).join(`url(#${key}__${id})`)
      .split(`href="#${id}"`).join(`href="#${key}__${id}"`);
  }

  // 4. Strip the editor leftovers and collapse the whitespace. These get
  //    inlined into the JS bundle, so the bytes are shipped on every load.
  out = out
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/>\s+</g, "><")
    .trim();

  return out;
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const entries = Object.entries(ILLUSTRATIONS);
  const results = await Promise.all(
    entries.map(async ([key, path]) => {
      const url = `${CDN}/${path}.svg`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${key}: ${url} -> HTTP ${response.status}`);

      const source = await response.text();
      if (!source.startsWith("<svg")) throw new Error(`${key}: ${url} did not return an SVG`);

      const out = transform(source, key);
      writeFileSync(join(OUT_DIR, `${key}.svg`), `${out}\n`, "utf8");
      return { key, url, before: source.length, after: out.length };
    }),
  );

  const total = results.reduce((sum, r) => sum + r.after, 0);
  for (const { key, before, after } of results) {
    const saved = Math.round((1 - after / before) * 100);
    console.log(`${key.padEnd(20)} ${String(before).padStart(6)} -> ${String(after).padStart(6)}  (-${saved}%)`);
  }
  console.log(`\n${results.length} files, ${(total / 1024).toFixed(1)} KB total, written to src/assets/illustrations/`);

  // The attribution table in NOTICE.md has to name the exact source of each
  // file. Print it so a re-run that changes the set shows what to paste.
  console.log("\nNOTICE.md rows:");
  for (const { key, url } of results) console.log(`| \`${key}.svg\` | ${url} |`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
