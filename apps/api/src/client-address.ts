/**
 * `X-Forwarded-For` and `X-Real-IP` are ignored: this process never faces the internet,
 * so only an address a BFF resolved and asserted over the SEC-4 channel is trustworthy.
 * The value is a rate-limit bucket key only: never logged, never a span attribute, never
 * in a response body, never persisted (SEC-13).
 */

import type { Context } from "hono";

export const CLIENT_ADDRESS_HEADER = "x-qcms-client-address";

// Unvouched callers share one coarse bucket rather than getting one bucket each.
export const UNKNOWN_CLIENT_ADDRESS = "unknown-ip";

// Bounds what an over-long header could do to the rate-limit store's key space.
const MAX_ADDRESS_LENGTH = 64;

export function clientAddress(c: Context): string {
  const raw = c.req.header(CLIENT_ADDRESS_HEADER)?.trim();
  if (raw === undefined || raw === "" || raw.length > MAX_ADDRESS_LENGTH) {
    return UNKNOWN_CLIENT_ADDRESS;
  }
  return raw;
}
