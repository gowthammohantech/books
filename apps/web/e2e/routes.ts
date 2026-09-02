import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The route list is read out of the router rather than hand-maintained — a
 * hardcoded list silently stops covering new screens, which is exactly the
 * failure mode this harness exists to prevent.
 */
function declaredPaths(file: string): string[] {
  const src = readFileSync(join(HERE, "..", "src", "routes", file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/path="([^"]+)"/g)) out.push(m[1]);
  return out;
}

const RAW = [...declaredPaths("AdminRoute.tsx"), ...declaredPaths("AppRoutes.tsx")];

/** Routes needing an id. Filled at runtime from the API, never hardcoded. */
export const PARAM_ROUTE_SOURCES: { pattern: string; endpoint: string; pick?: string }[] = [
  { pattern: "/products/view/:id", endpoint: "/api/products?limit=1" },
  { pattern: "/products/edit/:id", endpoint: "/api/products?limit=1" },
  { pattern: "/view-invoice/:id", endpoint: "/api/invoices?limit=1" },
  { pattern: "/invoices/edit-invoice/:invoiceId", endpoint: "/api/invoices?limit=1" },
  { pattern: "/contacts/:id", endpoint: "/api/contacts?limit=1" },
  { pattern: "/expenses/view/:id", endpoint: "/api/expenses?limit=1" },
];

/** Static, renderable routes: no params, no wildcards, no redirect-only entries. */
export const STATIC_ROUTES: string[] = [...new Set(RAW)]
  .filter((p) => p.startsWith("/"))
  .filter((p) => !p.includes(":") && !p.includes("*"))
  .filter((p) => !["/signin", "/signup", "/logout", "/sso", "/setup", "/workspaces"].includes(p))
  // These three mount third-party static sites in an iframe; the iframe's
  // internals are not ours to audit and a 100vh iframe would swamp the metrics.
  .filter((p) => !["/documentation", "/documentation/mobile", "/landing"].includes(p))
  .sort();

export const slugOf = (p: string) => p.replace(/^\//, "").replace(/\//g, "__") || "root";
