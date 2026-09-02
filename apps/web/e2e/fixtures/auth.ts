import type { Page } from "@playwright/test";

export const DEMO_EMAIL = process.env.EB_EMAIL ?? "admin@demo.elixirbooks.local";
export const DEMO_PASSWORD = process.env.EB_PASSWORD ?? "Demo123$";

export const STORAGE_STATE = "e2e/__artifacts__/storageState.json";

/**
 * Logs in through the real form.
 *
 * Injecting cookies directly does not work here: the session is a non-httpOnly
 * js-cookie triple (authToken / authUser / activeTenant) whose `authUser` and
 * `activeTenant` shapes would have to be reproduced by hand, and ProtectedRoute
 * *additionally* gates on systemSettings having loaded — so a hand-built cookie
 * set yields a permanent "Loading..." rather than a page.
 */
export async function login(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/signin`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').first().fill(DEMO_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 60_000 });
  await settled(page);
}

/**
 * Waits for a route to actually be rendered.
 *
 * `domcontentloaded` is not enough: ProtectedRoute renders a bare
 * `<div>Loading...</div>` until systemSettings resolves, so screenshotting on
 * load produces a page of spinners. ApexCharts also animates on mount, hence
 * the settle.
 */
export async function settled(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForFunction(
      () => {
        const t = document.body?.textContent ?? "";
        if (t.trim().startsWith("Loading...")) return false;
        return Boolean(document.querySelector("main, form, [role=alert], h1, h2"));
      },
      undefined,
      { timeout: 45_000 },
    )
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(450);
}

/** Kills chart entry animations so screenshots are stable and comparable. */
export async function disableAnimations(page: Page) {
  await page.addInitScript(() => {
    // ApexCharts reads window.Apex as a global defaults bag at construction.
    (window as unknown as { Apex?: Record<string, unknown> }).Apex = {
      chart: { animations: { enabled: false } },
    };
  });
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}`,
  }).catch(() => {});
}
