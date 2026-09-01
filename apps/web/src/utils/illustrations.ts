/**
 * The empty-state artwork, and how it reaches the page.
 *
 * The files are Storyset "rafiki" illustrations, fetched and rewritten by
 * `scripts/fetch-illustrations.mjs` — see that script for what is done to them
 * and why, and `NOTICE.md` for the attribution they are used under.
 *
 * Two decisions are worth explaining, because both look odd from the outside.
 *
 * **They are inlined as markup, not pointed at with `<img src>`.** An `<img>`
 * is an opaque document: a stylesheet in the host page cannot select anything
 * inside it, so an `<img>`-based illustration cannot be animated by our CSS at
 * all. Inlining is what lets `index.css` reach `[data-part="character"]` and
 * float it. The markup is first-party, committed, and produced by our own
 * script — the same trust level as the component that renders it, and no user
 * input reaches this path — so `dangerouslySetInnerHTML` is doing nothing
 * dangerous here.
 *
 * **They are loaded on demand rather than imported at the top.** Ten inlined
 * SVGs come to ~188 KB of markup. Importing them statically would put all of
 * that in the main bundle to render, typically, one of them — and empty states
 * are by definition the screens with the least on them. `import.meta.glob`
 * gives each file its own chunk, fetched the first time something asks for it
 * and cached from then on.
 *
 * The cost of that choice is a frame where the artwork is not there yet, which
 * is why `EmptyState` reserves the box up front: a late illustration must not
 * shove the text underneath it.
 */

/** The artwork available. Keep in step with `ILLUSTRATIONS` in the fetch script. */
export type IllustrationKey =
  | "no-data"
  | "empty"
  | "invoice"
  | "file-searching"
  | "people-search"
  | "folder"
  | "checking-boxes"
  | "cash-payment"
  | "analysis"
  | "push-notifications";

/**
 * Vite rewrites this at build time into a map of path -> dynamic import. The
 * path is relative and literal because that is all `import.meta.glob` accepts;
 * the `@assets` alias the rest of the app uses is not resolved here.
 */
const modules = import.meta.glob<string>("../assets/illustrations/*.svg", {
  query: "?raw",
  import: "default",
});

/** Resolved markup, so a second empty state on the page paints immediately. */
const cache = new Map<IllustrationKey, string>();

/** In-flight loads, so ten rows asking at once share one request. */
const pending = new Map<IllustrationKey, Promise<string | null>>();

/** Markup for `key` if it has already been loaded, else null. */
export const peekIllustration = (key: IllustrationKey): string | null =>
  cache.get(key) ?? null;

/**
 * Loads one illustration's markup.
 *
 * Resolves `null` rather than rejecting when the chunk cannot be fetched —
 * every caller is decoration sitting above a written-out message, so a missing
 * picture should cost the user nothing. Mirrors `loadBrandLogo` in
 * `brandLogo.ts`, which made the same call for the same reason.
 */
export const loadIllustration = (key: IllustrationKey): Promise<string | null> => {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const load = modules[`../assets/illustrations/${key}.svg`];
  if (!load) return Promise.resolve(null);

  const promise = load()
    .then((markup) => {
      cache.set(key, markup);
      return markup;
    })
    .catch(() => null)
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
};
