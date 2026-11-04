/**
 * Trust only the client address asserted by the BFF over the authenticated internal channel; use it solely
 * as a rate-limit bucket key, never telemetry or stored identity.
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
