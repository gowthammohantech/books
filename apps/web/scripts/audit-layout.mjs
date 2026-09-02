/**
 * Layout audit — finds AUTHORED fixed heights, not tall content.
 *
 * The obvious version of this check is wrong, and wrong in a way that looks
 * right: `getComputedStyle(el).height` returns a *used* value, so it is always
 * `<n>px` — for `height: auto`, for flex-derived heights, for everything. A
 * check that flags "computed height is a px literal >= 200" therefore flags
 * every table, every form column and every card grid, and can only be made to
 * pass by having no element taller than 200px anywhere. What we actually want
 * is the value the author *wrote*, which means reading the cascade.
 *
 * Three passes:
 *   A  walk document.styleSheets for px-literal height declarations. Reports
 *      the selector, so a developer can grep for it.
 *   B  inline styles and the `height` presentational attribute. ApexCharts
 *      writes `height:260px` onto its own wrapper and never appears in a
 *      stylesheet, so without this pass the single biggest offender is invisible.
 *   C  confirmation (exported separately, run AFTER screenshots): force the
 *      element to auto and re-measure. If the height does not change, the
 *      element was tall because of its content and passes A/B were false
 *      positives.
 */

/** Pass A + B, plus the assertions that are actually satisfiable. */
export const AUDIT_SOURCE = String.raw`(() => {
  const HEIGHT_PROPS = ['height', 'min-height', 'max-height', 'block-size', 'min-block-size'];
  const OK = /^(auto|100%|inherit|initial|unset|revert|revert-layer|fit-content|min-content|max-content|none|0|0px)$/i;
  const RESPONSIVE = /(vh|dvh|svh|lvh|vmin|vmax|%|clamp\(|min\(|max\(|calc\()/i;
  const MIN_PX = 200;       // height / max-height
  const MIN_PX_MINH = 120;  // min-height reserves space unconditionally, so it bites lower

  const pxOf = (v) => (/^-?[\d.]+px$/.test(v.trim()) ? parseFloat(v) : NaN);
  const flagged = (prop, v) => {
    const n = pxOf(v);
    if (Number.isNaN(n)) return false;
    return n >= (prop.includes('min-') ? MIN_PX_MINH : MIN_PX);
  };

  // ---- Pass A: author stylesheets ----------------------------------------
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch { continue; }   // cross-origin
    (function walk(rs, conditions) {
      for (const r of rs) {
        if (r.cssRules) {
          walk(r.cssRules, r.conditionText ? conditions.concat(r.conditionText) : conditions);
          continue;
        }
        if (!r.style || !r.selectorText) continue;
        for (const p of HEIGHT_PROPS) {
          const v = r.style.getPropertyValue(p);
          if (!v || OK.test(v.trim()) || RESPONSIVE.test(v)) continue;
          if (!flagged(p, v)) continue;
          rules.push({ selector: r.selectorText, prop: p, value: v.trim(), conditions });
        }
      }
    })(list, []);
  }

  const hits = [];
  const seen = new WeakMap();
  const mainEl = document.querySelector('main');
  const paneH = mainEl ? mainEl.clientHeight : innerHeight;

  const record = (el, prop, value, source) => {
    if (el.closest('[data-fixed-height-ok]')) return;  // explicit, greppable exemption
    const key = prop + ':' + value;
    const s = seen.get(el) || new Set();
    if (s.has(key)) return;
    s.add(key); seen.set(el, s);
    const r = el.getBoundingClientRect();
    hits.push({
      prop, value, source,
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 160),
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      exceedsPane: r.height > paneH,
    });
  };

  for (const rule of rules) {
    let els = [];
    try { els = document.querySelectorAll(rule.selector); } catch { continue; }  // ::part etc
    for (const el of els) record(el, rule.prop, rule.value, 'css:' + rule.selector);
  }

  // ---- Pass B: inline styles + height attribute ---------------------------
  for (const el of document.querySelectorAll('[style],[height]')) {
    for (const p of HEIGHT_PROPS) {
      const v = el.style.getPropertyValue(p);
      if (v && !OK.test(v.trim()) && !RESPONSIVE.test(v) && flagged(p, v)) {
        record(el, p, v.trim(), 'inline');
      }
    }
    // The height attribute is only a layout signal on HTML elements. Inside
    // SVG it is geometry, and a chart library emits it *derived* from the size
    // it was given — so a responsive chart reports a different value at every
    // viewport and would be flagged forever. Excluding the SVG namespace is
    // the same instinct as the img exclusion, generalised.
    const attr = el.getAttribute('height');
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    if (attr && /^\d+$/.test(attr) && +attr >= MIN_PX && el.tagName !== 'IMG' && !isSvg) {
      record(el, 'height-attr', attr, 'attr');
    }
  }

  // ---- Satisfiable assertions --------------------------------------------
  const coarse = matchMedia('(pointer: coarse)').matches;
  const floor = coarse ? 44 : 32;
  // Exactly the selector the base-layer floor enforces. Two deliberate
  // exclusions: checkboxes and radios (a 44px glyph is wrong — their label
  // carries the target), and a plain href anchor, which is an inline text link
  // in a breadcrumb or a sentence, not a control. Auditing something the CSS
  // does not enforce would produce a permanent, unfixable failure list.
  const smallTargets = [...document.querySelectorAll(
      'button,[role="button"],a[role="button"],summary,select,textarea,' +
      'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden])')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.height > 0 && r.height < floor - 0.5 && !el.closest('[data-hit="tight"]'))
    .map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 120),
      text: (el.textContent || '').trim().slice(0, 40),
      h: Math.round(r.height * 10) / 10,
    }));

  const de = document.documentElement;
  const horizontalOffenders = [...document.querySelectorAll('body *')]
    .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
    .slice(0, 10)
    .map((el) => el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '').slice(0, 80));

  return {
    authoredFixedHeights: hits,
    smallTargets,
    horizontalOverflow: de.scrollWidth > de.clientWidth,
    horizontalOffenders,
    mainScrollHeight: mainEl ? mainEl.scrollHeight : null,
    mainClientHeight: mainEl ? mainEl.clientHeight : null,
    overflowRatio: mainEl ? +(mainEl.scrollHeight / Math.max(1, mainEl.clientHeight)).toFixed(3) : null,
    tightHits: document.querySelectorAll('[data-hit="tight"]').length,
    apexRects: [...document.querySelectorAll('.apexcharts-canvas')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }),
    cardWidths: [...document.querySelectorAll('.eb-kpi-card')].map(
      (el) => Math.round(el.getBoundingClientRect().width)),
  };
})()`;

/**
 * Pass C — empirical confirmation. Mutates the DOM, so this must run in its
 * own evaluate AFTER every screenshot for the route has been taken.
 * Returns the subset of candidates whose height genuinely came from the author.
 */
export const CONFIRM_SOURCE = String.raw`((candidates) => {
  const out = [];
  const all = [...document.querySelectorAll('[style],[height],*')];
  for (const c of candidates) {
    // Re-find by the recorded class + tag; good enough to confirm a sample.
    const el = all.find((e) => e.tagName.toLowerCase() === c.tag &&
                               (e.getAttribute('class') || '').slice(0, 160) === c.cls);
    if (!el) continue;
    const prev = el.getAttribute('style');
    const before = el.getBoundingClientRect().height;
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    const after = el.getBoundingClientRect().height;
    if (prev === null) el.removeAttribute('style'); else el.setAttribute('style', prev);
    if (Math.abs(before - after) > 4) out.push({ ...c, before: Math.round(before), after: Math.round(after) });
  }
  return out;
})`;
