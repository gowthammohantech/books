import Constants from '@constants/api';

/**
 * Resolve a server-provided image/upload URL against the API origin the browser
 * actually reaches (`VITE_API_BASE_URL`).
 *
 * The backend stamps absolute URLs using the request host. Behind a reverse
 * proxy that doesn't forward the original Host, that host can be the API's
 * internal address (e.g. 127.0.0.1:5000), which the browser can't load. This
 * keeps only the path and re-bases it onto the known-reachable origin, so it
 * works in every deployment (docker, dev, proxied prod). Relative paths are
 * prefixed the same way.
 */
export function assetUrl(url?: string | null): string {
  if (!url) return '';
  const base = (Constants.BASE_URL || '').replace(/\/$/, '');
  let path = url;
  try {
    // Absolute URL — discard the (possibly unreachable) origin, keep the path.
    path = new URL(url).pathname;
  } catch {
    // Not absolute — treat as a path as-is.
  }
  if (!/^https?:\/\//i.test(path) && !path.startsWith('/')) path = `/${path}`;
  return base + path;
}

export default assetUrl;
