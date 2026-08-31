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
 */

const FALLBACKS = {
  background: "#fafafa",
  foreground: "#000000",
  card: "#ffffff",
  primary: "#3f5ec2",
  "primary-foreground": "#eff6ff",
  secondary: "#ebebeb",
  "secondary-foreground": "#222222",
  muted: "#f5f5f5",
  "muted-foreground": "#525252",
  accent: "#dbe6f6",
  "accent-foreground": "#14185a",
  destructive: "#df2225",
  border: "#e4e4e4",
  input: "#ebebeb",
  ring: "#3f5ec2",
  success: "#27ae60",
  warning: "#e2b93b",
  info: "#06aed4",
  indigo: "#3538cd",
  teal: "#0e9384",
  "chart-1": "#dbe6f6",
  "chart-2": "#9ab0e5",
  "chart-3": "#6a7ccd",
  "chart-4": "#3f5ec2",
  "chart-5": "#14185a",
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
