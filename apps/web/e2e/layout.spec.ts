import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_SOURCE, CONFIRM_SOURCE } from "../scripts/audit-layout.mjs";
import { login, settled, disableAnimations } from "./fixtures/auth";
import { STATIC_ROUTES, slugOf } from "./routes";

/** `baseline` before the fix, `candidate` after — the two are diffed directly. */
const LABEL = process.env.EB_LABEL ?? "candidate";
const ART = join("e2e", "__artifacts__", LABEL);

/**
 * The four viewports the brief names, plus a touch profile.
 *
 * 1366x768 is the worst realistic laptop; 1461x878 is the window the bug was
 * reported from. Chromium reports `pointer: coarse` when hasTouch is set,
 * which is the only way to exercise the 44px target floor.
 */
const VIEWPORTS = [
  { w: 1366, h: 768, touch: false },
  { w: 1461, h: 878, touch: false },
  { w: 1920, h: 1080, touch: false },
  { w: 2560, h: 1440, touch: false },
  { w: 1024, h: 1366, touch: true },
];

/** The screens the PR shows before/after. One of each kind of page. */
const REPRESENTATIVE = [
  "/dashboard",
  "/invoices",
  "/invoices/create-invoice",
  "/contacts",
  "/accounting/reports/profit-loss",
  "/settings/company-settings",
  "/banking",
  "/accounting/chart-of-accounts",
];

const SHOOT_ALL = process.env.EB_SHOTS === "all";
const ROUTES = process.env.EB_ROUTES ? process.env.EB_ROUTES.split(",") : STATIC_ROUTES;

type Metric = Record<string, unknown> & { route: string; viewport: string };
const metrics: Metric[] = [];

test.describe.configure({ mode: "serial" });

test("layout sweep", async ({ browser }, testInfo) => {
  testInfo.setTimeout(60 * 60 * 1000);
  mkdirSync(ART, { recursive: true });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: vp.touch,
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await disableAnimations(page);

    const baseURL = testInfo.project.use.baseURL as string;
    await login(page, baseURL);

    const dir = join(ART, `${vp.w}x${vp.h}`);
    mkdirSync(dir, { recursive: true });

    for (const route of ROUTES) {
      try {
        await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await settled(page);
      } catch {
        metrics.push({ route, viewport: `${vp.w}x${vp.h}`, error: "navigation-failed" });
        continue;
      }

      const shouldShoot = SHOOT_ALL || REPRESENTATIVE.includes(route);
      if (shouldShoot) {
        await page
          .screenshot({ path: join(dir, `${slugOf(route)}.png`) })
          .catch(() => {});
      }

      // Audit AFTER the screenshot — pass C mutates the DOM.
      const audit = (await page.evaluate(AUDIT_SOURCE)) as Record<string, unknown>;
      const candidates = (audit.authoredFixedHeights ?? []) as unknown[];
      const confirmed = candidates.length
        ? await page.evaluate(`(${CONFIRM_SOURCE})(${JSON.stringify(candidates)})`)
        : [];

      metrics.push({
        route,
        viewport: `${vp.w}x${vp.h}`,
        touch: vp.touch,
        ...audit,
        authoredFixedHeights: confirmed,
      });
    }
    await ctx.close();
  }

  writeFileSync(join(ART, "metrics.json"), JSON.stringify(metrics, null, 2));

  // ---- Report, then assert. A bare "expected 0, got 47" is useless here; the
  //      point of the sweep is knowing WHICH route and WHICH element.
  const overflow = metrics.filter((m) => m.horizontalOverflow);
  const fixed = metrics.filter((m) => (m.authoredFixedHeights as unknown[])?.length);
  const small = metrics.filter((m) => (m.smallTargets as unknown[])?.length);

  const summarise = (rows: Metric[], key: string) =>
    rows
      .slice(0, 25)
      .map((m) => `  ${m.route} @${m.viewport}: ${JSON.stringify((m as never)[key]).slice(0, 200)}`)
      .join("\n");

  console.log(`\n=== ${LABEL} — ${ROUTES.length} routes x ${VIEWPORTS.length} viewports ===`);
  console.log(`horizontal overflow : ${overflow.length}\n${summarise(overflow, "horizontalOffenders")}`);
  console.log(`authored fixed h    : ${fixed.length}\n${summarise(fixed, "authoredFixedHeights")}`);
  console.log(`sub-floor targets   : ${small.length}\n${summarise(small, "smallTargets")}`);

  const worst = [...metrics]
    .filter((m) => typeof m.overflowRatio === "number")
    .sort((a, b) => (b.overflowRatio as number) - (a.overflowRatio as number))
    .slice(0, 15);
  console.log(`\nworst overflow ratios:`);
  for (const m of worst) console.log(`  ${(m.overflowRatio as number).toFixed(2)}  ${m.route} @${m.viewport}`);

  if (process.env.EB_ASSERT === "1") {
    expect(overflow, "routes with horizontal page overflow").toHaveLength(0);
    expect(fixed, "routes with authored fixed heights").toHaveLength(0);
    expect(small, "routes with sub-floor hit targets").toHaveLength(0);
  }
});
