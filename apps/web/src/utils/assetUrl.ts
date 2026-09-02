import Constants from '@constants/api';

/**
 * Resolve a server-provided image/upload URL into something the browser can load.
 *
 * Uploads live in Azure Blob Storage now, and the API hands back a signed,
 * time-limited URL that is absolute and carries a `?sv=...&sig=...` query. Those
 * are already reachable and must be returned UNTOUCHED — the signature covers
 * the blob path, so rewriting the origin or dropping the query invalidates it.
 *
 * The rebasing below is for the relative paths a few older responses still
 * return; it prefixes the API origin the browser actually reaches, the way this
 * helper always did.
 */
export function assetUrl(url?: string | null): string {
  if (!url) return '';
  // Absolute already — a signed blob URL, or anything else fully qualified.
  if (/^https?:\/\//i.test(url)) return url;
  const base = (Constants.BASE_URL || '').replace(/\/$/, '');
  return base + (url.startsWith('/') ? url : `/${url}`);
}

export default assetUrl;
