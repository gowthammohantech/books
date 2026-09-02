import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Strip a trailing port from a forwarded client address.
 *
 * Azure App Service writes `X-Forwarded-For: <client-ip>:<port>`, so with
 * `trust proxy` on, `req.ip` arrives as e.g. `106.51.59.68:51977`.
 * express-rate-limit rejects that (ERR_ERL_INVALID_IP_ADDRESS) and every
 * limited request logged a ValidationError instead of being counted — the
 * limiter was effectively off.
 *
 * IPv4 keeps everything before the single colon; a bracketed IPv6
 * (`[::1]:443`) keeps what is inside the brackets. A bare IPv6 has many colons
 * and no port, so it passes through untouched.
 */
export function stripPort(ip: string): string {
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(ip);
  if (bracketed) return bracketed[1]!;
  const colons = ip.split(':');
  if (colons.length === 2 && /^\d+$/.test(colons[1]!)) return colons[0]!;
  return ip;
}

/**
 * The key every IP-based limiter in this app should use. Normalises the address
 * first (see {@link stripPort}), then hands it to express-rate-limit's own
 * generator so IPv6 clients are grouped by /56 rather than by single address.
 */
export function ipKey(req: Request): string {
  return ipKeyGenerator(stripPort(req.ip ?? ''));
}
