/**
 * Design tokens as JavaScript values.
 *
 * Most of the UI consumes tokens as Tailwind classes, which resolve against
 * the custom properties in `index.css`. Three subsystems cannot do that and
 * need a literal color string instead:
 *
 *   - MUI, whose palette is computed in JS (it derives light/dark variants,
 *     so it cannot be handed a `var(--primary)` string)
 *   - ApexCharts and Recharts, which take color arrays in their config
 *   - anything drawing to a canvas or PDF
 *
 * Those places previously hardcoded hex literals that duplicated the token
 * values, which is how `#7539FF` survived a whole rebrand in a dozen files.
 * Read from here instead.
 *
 * Values are read from the live custom properties so this file cannot drift
 * from `index.css`. The literals below are only a fallback for the case where
 * the stylesheet has not been applied yet (module evaluation racing the style
 * injection, or a non-browser environment such as a test runner).
 *
 * That race is real, not theoretical: muiTheme.ts calls themeColor() at module
 * scope, so a stale fallback here does not fail — it renders the previous
 * palette on a fast load and then never corrects itself, because a successful
 * read is memoised. Update these whenever :root moves.
 */

const FALLBACKS = {
  background: "#f8f8f8",
  foreground: "#383838",
  card: "#ffffff",
  primary: "#3f5ec2",
  "primary-foreground": "#eff6ff",
  secondary: "#ededed",
  "secondary-foreground": "#383838",
  muted: "#f3f3f3",
  "muted-foreground": "#525252",
  accent: "#dbe6f6",
  "accent-foreground": "#14185a",
  destructive: "#cc2929",
  border: "#ededed",
  input: "#f3f3f3",
  ring: "#0070cc",
  success: "#30a66d",
  warning: "#edba13",
  info: "#0289f7",
  indigo: "#3538cd",
  teal: "#0b9e92",
  "chart-1": "#dbe6f6",
  "chart-2": "#9ab0e5",
  "chart-3": "#6a7ccd",
  "chart-4": "#3f5ec2",
  "chart-5": "#14185a",
  // Ramp steps the JS consumers need directly: react-select and the MUI
  // input surfaces are rebuilt on the ERPNext control fills.
  "blue-700": "#0070cc",
  "gray-100": "#f3f3f3",
  "gray-200": "#ededed",
  "gray-500": "#999999",
  "gray-700": "#525252",
  "control-bg": "#f3f3f3",
  "focus-neutral": "rgba(124, 124, 124, 0.25)",
  "control-bg-on-gray": "#ededed",
} as const;

export type TokenName = keyof typeof FALLBACKS;

const cache = new Map<TokenName, string>();

/**
 * Resolve a token to a concrete color string.
 *
 * Reads lazily and memoises only a successful read, so a call made before the
 * stylesheet lands returns the fallback without poisoning the cache for later
 * callers.
 */
export function themeColor(name: TokenName): string {
  const hit = cache.get(name);
  if (hit) return hit;

  if (typeof window !== "undefined" && typeof getComputedStyle === "function") {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${name}`)
      .trim();
    if (value) {
      cache.set(name, value);
      return value;
    }
  }
  return FALLBACKS[name];
}

/**
 * Convert a token color to an [r, g, b] tuple.
 *
 * Canvas and PDF targets (jsPDF, jspdf-autotable) take numeric components, not
 * CSS color strings. Falls back to mid-grey for any value this cannot parse —
 * a wrong-but-visible table beats a thrown exception during an export.
 */
export function hexToRgb(color: string): [number, number, number] {
  let hex = color.trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return [128, 128, 128];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** Convenience for chart series, in the order the palette intends. */
export const chartPalette = (): string[] => [
  themeColor("chart-4"),
  themeColor("info"),
  themeColor("success"),
  themeColor("warning"),
  themeColor("chart-5"),
];

/** Two-series charts (e.g. paid vs outstanding). */
export const chartPair = (): string[] => [themeColor("chart-4"), themeColor("info")];
