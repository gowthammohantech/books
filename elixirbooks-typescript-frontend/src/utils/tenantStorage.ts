/**
 * Per-workspace browser storage.
 *
 * WHY THIS EXISTS. Everything the SPA caches in localStorage/sessionStorage was
 * written when an install served exactly one company, so the keys are bare
 * nouns: `systemSettings`, `setupStatus`, `nextInvoiceNo`. The moment a person
 * belongs to two workspaces those keys collide, and the collision is not a
 * cosmetic one — `systemSettings` carries the company name, logo, tax regime,
 * default currency AND the permission set. A stale copy after a switch shows
 * one company's branding over another company's data, and hands the user a
 * permission set their membership in this workspace does not grant.
 *
 * So every cached value is namespaced by the workspace it was read for:
 *
 *     systemSettings  ->  eb:<tenantId>:systemSettings
 *
 * A value written for workspace A is then simply not found while workspace B is
 * active, which is the behaviour we want: a cache miss re-fetches, whereas a
 * cache hit on the wrong tenant's data is silent and wrong.
 *
 * WHY THE TENANT ID COMES FROM THE JWT. The token is what the backend actually
 * scopes by — its `tenantId` claim decides which rows the API returns. Reading
 * the namespace from anywhere else (a separate cookie, redux) risks the cache
 * being keyed by one workspace while the requests that filled it were answered
 * for another. Deriving it from the token makes that class of skew impossible:
 * if the token changes, the namespace changes with it, in the same instant.
 *
 * TESTABILITY. The two exported stores are built by `createTenantStore`, which
 * takes its backing Storage as a thunk. Tests pass a fake; the browser build
 * passes the real thing. That also gives us the null-safety we need anyway —
 * Safari private mode and "block all cookies" both make `localStorage` throw on
 * access rather than return null.
 */
import { jwtDecode } from "jwt-decode";
import Cookies from "js-cookie";

/** Prefix for every key this module owns. Short, because keys are quota. */
export const NAMESPACE = "eb";

/**
 * Keys that are per-workspace. Listed rather than inferred so that
 * `purgeTenantScoped` knows what it may delete, and so adding a cached value
 * without thinking about tenancy is a visible act.
 */
export const TENANT_SCOPED_KEYS = [
    "systemSettings",
    "setupStatus",
    "nextInvoiceNo",
    "defaultNextInvNo",
    "nextPurchaseOrderId",
] as const;

export type TenantScopedKey = (typeof TENANT_SCOPED_KEYS)[number];

/** `eb:<tenantId>:<key>`. Exported because the tests assert on the shape. */
export function tenantKey(tenantId: string, key: string): string {
    return `${NAMESPACE}:${tenantId}:${key}`;
}

/** True for any key this module owns, whichever workspace it belongs to. */
export function isTenantScopedKey(key: string): boolean {
    return key.startsWith(`${NAMESPACE}:`);
}

/**
 * Parse a stored JSON value, discarding anything unparseable.
 *
 * Moved here from AppRoutes/SetupStatusContext, where it guarded the setup
 * status. That guard is not defensive programming for its own sake — a bad
 * value there throws during the router's first render, which white-screens the
 * app with no way to clear the value short of devtools. The bad value is
 * written by an ordinary mistake: `JSON.stringify(undefined)` returns
 * `undefined`, which Storage coerces to the literal string "undefined".
 *
 * `null` is rejected along with the junk: it parses fine and then destructures
 * to undefined fields at every call site downstream.
 */
export function parseStored<T>(raw: string | null | undefined): T | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as T) : null;
    } catch {
        return null;
    }
}

export interface TenantStore {
    get(tenantId: string, key: string): string | null;
    set(tenantId: string, key: string, value: string): void;
    remove(tenantId: string, key: string): void;
    getJson<T>(tenantId: string, key: string): T | null;
    setJson(tenantId: string, key: string, value: unknown): void;
    /** Every `eb:` key currently present, across all workspaces. */
    keys(): string[];
    /** Drop `eb:` keys; pass a tenant id to keep that workspace's. */
    purge(keepTenantId?: string | null): void;
}

/**
 * Build a store over a Storage that may not exist and may throw on touch.
 *
 * Every operation is individually guarded: a browser can permit reads and
 * refuse writes (quota), and a caching convenience must never be the reason a
 * page fails to render.
 */
export function createTenantStore(backing: () => Storage | null): TenantStore {
    const storage = (): Storage | null => {
        try {
            return backing();
        } catch {
            return null;
        }
    };

    const keys = (): string[] => {
        const s = storage();
        if (!s) return [];
        const out: string[] = [];
        try {
            for (let i = 0; i < s.length; i += 1) {
                const k = s.key(i);
                if (k && isTenantScopedKey(k)) out.push(k);
            }
        } catch {
            return out;
        }
        return out;
    };

    return {
        get(tenantId, key) {
            const s = storage();
            if (!s || !tenantId) return null;
            try {
                return s.getItem(tenantKey(tenantId, key));
            } catch {
                return null;
            }
        },
        set(tenantId, key, value) {
            const s = storage();
            if (!s || !tenantId) return;
            try {
                s.setItem(tenantKey(tenantId, key), value);
            } catch {
                // Private mode / quota. The value stays in memory for this
                // session, which is strictly better than failing the write path.
            }
        },
        remove(tenantId, key) {
            const s = storage();
            if (!s || !tenantId) return;
            try {
                s.removeItem(tenantKey(tenantId, key));
            } catch {
                /* nothing to do */
            }
        },
        getJson<T>(tenantId: string, key: string): T | null {
            return parseStored<T>(this.get(tenantId, key));
        },
        setJson(tenantId, key, value) {
            // Do not persist undefined: JSON.stringify(undefined) is undefined,
            // and Storage would write the string "undefined" — the exact
            // poisoning `parseStored` exists to survive. Refuse at the source.
            if (value === undefined || value === null) return;
            let encoded: string;
            try {
                encoded = JSON.stringify(value);
            } catch {
                return;
            }
            this.set(tenantId, key, encoded);
        },
        keys,
        purge(keepTenantId) {
            const s = storage();
            if (!s) return;
            const keep = keepTenantId ? `${NAMESPACE}:${keepTenantId}:` : null;
            for (const k of keys()) {
                if (keep && k.startsWith(keep)) continue;
                try {
                    s.removeItem(k);
                } catch {
                    /* nothing to do */
                }
            }
        },
    };
}

const browserStorage = (pick: () => Storage): (() => Storage | null) => () => {
    // `typeof` rather than a truthiness check: in a non-browser runtime the
    // identifier is not merely falsy, referencing it is a ReferenceError.
    if (typeof window === "undefined") return null;
    return pick();
};

export const tenantLocal = createTenantStore(browserStorage(() => window.localStorage));
export const tenantSession = createTenantStore(browserStorage(() => window.sessionStorage));

/**
 * The workspace the current token is scoped to, or null when signed out.
 *
 * Reads the cookie directly rather than the redux store so that non-React code
 * (the axios interceptor, module-level helpers) can call it, and so it cannot
 * disagree with the token actually being sent on the wire.
 */
export function currentTenantId(): string | null {
    const token = Cookies.get("authToken");
    if (!token) return null;
    try {
        const claims = jwtDecode<{ tenantId?: string | null }>(token);
        return claims?.tenantId ?? null;
    } catch {
        return null;
    }
}

/**
 * Read/write a plain string cached for the ACTIVE workspace.
 *
 * The next-document-number values (`nextInvoiceNo`, `nextPurchaseOrderId`) are
 * the reason these exist and the reason they are not merely a nicety: the value
 * read back is SUBMITTED as the number of the document being created. Shared
 * between workspaces, a user who visits company A's invoice list and then
 * creates an invoice in company B submits A's next number.
 *
 * Both no-op while signed out rather than falling back to an un-namespaced key
 * - a miss costs one request, a cross-workspace hit costs a wrong number.
 */
export function getTenantValue(key: string): string | null {
    const tenantId = currentTenantId();
    return tenantId ? tenantSession.get(tenantId, key) : null;
}

export function setTenantValue(key: string, value: string): void {
    const tenantId = currentTenantId();
    if (tenantId) tenantSession.set(tenantId, key, value);
}

/**
 * Remove cached data for every workspace except (optionally) one.
 *
 * Called on logout with no argument — nothing about the previous session should
 * survive on a shared machine — and after a successful switch with the new
 * workspace's id, which bounds how much stale data can accumulate for someone
 * who belongs to many workspaces.
 */
export function purgeTenantScoped(keepTenantId?: string | null): void {
    tenantLocal.purge(keepTenantId);
    tenantSession.purge(keepTenantId);
}

/**
 * One-time sweep of the un-namespaced keys written by every build before this
 * one. Without it, a returning user carries a bare `systemSettings` around
 * forever: harmless while it is ignored, but it is another company's data on
 * disk, and it will confuse whoever next debugs a stale-cache report.
 */
export function migrateLegacyKeys(): void {
    if (typeof window === "undefined") return;
    for (const [store, key] of [
        [window.localStorage, "systemSettings"],
        [window.sessionStorage, "setupStatus"],
        [window.sessionStorage, "nextInvoiceNo"],
        [window.sessionStorage, "defaultNextInvNo"],
        [window.sessionStorage, "nextPurchaseOrderId"],
    ] as const) {
        try {
            store.removeItem(key);
        } catch {
            /* nothing to do */
        }
    }
}
