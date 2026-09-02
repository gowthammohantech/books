import { defineConfig } from "@playwright/test";

/**
 * The sandbox ships a pinned Chromium build that will not match whatever
 * revision this @playwright/test happens to want, and there is no network
 * budget to download another. Point at the installed binary instead.
 */
const CHROMIUM = process.env.EB_CHROMIUM ?? "/opt/pw-browsers/chromium";

/**
 * Layout regression harness. Not a functional test suite — it drives every
 * route at a spread of viewports and records how the layout behaves, so the
 * "is it usable at 100% zoom" question has an answer that is measured rather
 * than eyeballed.
 *
 * Runs against a real API and a demo-seeded database on purpose. A mocked
 * fixture with three short invoice rows would validate nothing about the case
 * that caused this work: a 25-row table of real customer names in a pane that
 * is 824px tall.
 */
export default defineConfig({
  testDir: "./e2e",
  // Serial: every worker would otherwise contend for the one dev server and
  // the one database, and layout measurements taken under load are noise.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "e2e/__artifacts__/report.json" }]],
  use: {
    baseURL: process.env.EB_BASE_URL ?? "http://localhost:3000",
    // Deterministic screenshots: a caret blinking in a filter box is a diff.
    actionTimeout: 15_000,
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: CHROMIUM,
      // Chromium refuses to sandbox as uid 0, which is what this container is.
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
});
