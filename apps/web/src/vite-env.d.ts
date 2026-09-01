/// <reference types="vite/client" />

/**
 * The env vars this app reads. Previously untyped, so `import.meta.env.VITE_API_BASE_URL`
 * was `any` and its absence produced request URLs beginning with the literal
 * string "undefined" rather than a type error.
 */
interface ImportMetaEnv {
  /** API origin. Empty means same-origin, which is what the nginx proxy serves. */
  readonly VITE_API_BASE_URL?: string;
  /** Locks the UI into read-only demo behaviour. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
