import { describe, expect, it } from "vitest";

import {
    NAMESPACE,
    createTenantStore,
    isTenantScopedKey,
    parseStored,
    tenantKey,
} from "./tenantStorage";

/**
 * A Storage that lives in a Map. `createTenantStore` takes its backing store as
 * a thunk precisely so this is possible: vitest runs in node here, where
 * `localStorage` does not exist.
 */
function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        key: (i: number) => [...map.keys()][i] ?? null,
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => {
            map.set(k, String(v));
        },
        removeItem: (k: string) => {
            map.delete(k);
        },
        clear: () => map.clear(),
    } as Storage;
}

/** Every browser that refuses site data does this: throw, not return null. */
function throwingStorage(): Storage {
    const boom = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
    };
    return {
        get length(): number {
            return boom();
        },
        key: boom,
        getItem: boom,
        setItem: boom,
        removeItem: boom,
        clear: boom,
    } as unknown as Storage;
}

/**
 * A store over ONE fake Storage. The backing is a thunk so it can be resolved
 * lazily in the browser — not so it can be rebuilt per call, which would make
 * the store look amnesiac.
 */
function storeOver(backing: Storage) {
    return createTenantStore(() => backing);
}

const A = "tenant-a";
const B = "tenant-b";

describe("tenantKey", () => {
    it("namespaces by workspace", () => {
        expect(tenantKey(A, "systemSettings")).toBe(`${NAMESPACE}:${A}:systemSettings`);
    });

    it("recognises its own keys and nothing else", () => {
        expect(isTenantScopedKey(tenantKey(A, "x"))).toBe(true);
        // The un-namespaced key every build before this one wrote.
        expect(isTenantScopedKey("systemSettings")).toBe(false);
        expect(isTenantScopedKey("commandPalette.recents")).toBe(false);
    });
});

describe("parseStored", () => {
    it("returns the object for valid JSON", () => {
        expect(parseStored<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    });

    it('survives the literal string "undefined"', () => {
        // JSON.stringify(undefined) is undefined, which Storage coerces to this
        // string. Left unguarded it throws during the router's first render,
        // which white-screens the app with no way for the user to clear it.
        expect(parseStored("undefined")).toBeNull();
    });

    it("rejects null, which parses fine and then breaks every consumer", () => {
        expect(parseStored("null")).toBeNull();
    });

    it("rejects scalars, truncated JSON, empty and missing values", () => {
        expect(parseStored('"a string"')).toBeNull();
        expect(parseStored("42")).toBeNull();
        expect(parseStored('{"a":')).toBeNull();
        expect(parseStored("")).toBeNull();
        expect(parseStored(null)).toBeNull();
        expect(parseStored(undefined)).toBeNull();
    });
});

describe("a tenant store", () => {
    it("does not serve one workspace's value to another", () => {
        // The headline property. A miss re-fetches; a hit on the wrong
        // workspace's data is silent and wrong.
        const store = storeOver(makeStorage());
        store.set(A, "systemSettings", "acme");
        expect(store.get(A, "systemSettings")).toBe("acme");
        expect(store.get(B, "systemSettings")).toBeNull();
    });

    it("round-trips JSON per workspace", () => {
        const store = storeOver(makeStorage());
        store.setJson(A, "setupStatus", { companySettingsComplete: true });
        store.setJson(B, "setupStatus", { companySettingsComplete: false });
        expect(store.getJson(A, "setupStatus")).toEqual({ companySettingsComplete: true });
        expect(store.getJson(B, "setupStatus")).toEqual({ companySettingsComplete: false });
    });

    it("refuses to persist undefined rather than writing the string", () => {
        const backing = makeStorage();
        const store = storeOver(backing);
        store.setJson(A, "setupStatus", undefined);
        expect(backing.getItem(tenantKey(A, "setupStatus"))).toBeNull();
        expect(store.getJson(A, "setupStatus")).toBeNull();
    });

    it("writes nothing when there is no workspace to key by", () => {
        // Signed out. Falling back to an un-namespaced key would recreate the
        // exact collision this module exists to remove.
        const backing = makeStorage();
        const store = storeOver(backing);
        store.set("", "systemSettings", "x");
        expect(backing.length).toBe(0);
        expect(store.get("", "systemSettings")).toBeNull();
    });

    it("removes a single key without touching its neighbours", () => {
        const store = storeOver(makeStorage());
        store.set(A, "systemSettings", "1");
        store.set(A, "setupStatus", "2");
        store.remove(A, "systemSettings");
        expect(store.get(A, "systemSettings")).toBeNull();
        expect(store.get(A, "setupStatus")).toBe("2");
    });
});

describe("purge", () => {
    it("keeps the named workspace and drops every other", () => {
        const store = storeOver(makeStorage());
        store.set(A, "systemSettings", "acme");
        store.set(B, "systemSettings", "globex");
        store.purge(A);
        expect(store.get(A, "systemSettings")).toBe("acme");
        expect(store.get(B, "systemSettings")).toBeNull();
    });

    it("with no argument drops everything — this is logout", () => {
        const store = storeOver(makeStorage());
        store.set(A, "systemSettings", "acme");
        store.set(B, "systemSettings", "globex");
        store.purge();
        expect(store.keys()).toEqual([]);
    });

    it("leaves keys it does not own alone", () => {
        // `commandPalette.recents` is deliberately per-browser, and a purge
        // must not be a licence to delete storage this module never wrote.
        const backing = makeStorage();
        backing.setItem("commandPalette.recents", '["invoices"]');
        const store = storeOver(backing);
        store.set(A, "systemSettings", "acme");
        store.purge();
        expect(backing.getItem("commandPalette.recents")).toBe('["invoices"]');
    });
});

describe("a hostile or absent Storage", () => {
    it("reads as empty rather than throwing", () => {
        // Safari private mode and "block all site data" both throw on access.
        // A caching convenience must never be why a page fails to render.
        const store = createTenantStore(throwingStorage);
        expect(() => store.set(A, "systemSettings", "x")).not.toThrow();
        expect(store.get(A, "systemSettings")).toBeNull();
        expect(store.getJson(A, "systemSettings")).toBeNull();
        expect(store.keys()).toEqual([]);
        expect(() => store.purge()).not.toThrow();
        expect(() => store.remove(A, "systemSettings")).not.toThrow();
    });

    it("treats a missing Storage the same way", () => {
        const store = createTenantStore(() => null);
        expect(() => store.set(A, "k", "v")).not.toThrow();
        expect(store.get(A, "k")).toBeNull();
        expect(store.keys()).toEqual([]);
    });
});
