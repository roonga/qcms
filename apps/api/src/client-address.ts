/**
 * The client address, as vouched for by a BFF (issue #341).
 *
 * ## Why this is not `X-Forwarded-For`
 *
 * `X-Forwarded-For` is a list of claims, and reading its first entry - which is
 * what this API used to do - trusts whichever of those claims the client wrote.
 * The API is also the wrong process to interpret it: it never faces the internet
 * (ADR-20 invariant 4; `api` publishes no host port and no ingress recipe routes
 * it), it is reached only through a BFF, and it has no way to know how many
 * proxies sit in front of that BFF. Whatever address it can act on has to be one
 * the BFF resolved and asserted.
 *
 * So the contract is a dedicated header meaning exactly "the BFF vouched for
 * this", set by `apps/portal/lib/server/client-address.ts` after it counts
 * trusted hops from the right of its own inbound chain. It rides the SEC-4
 * internal-token channel that every mounted surface is behind
 * (`middleware/internal-token.ts`), so setting it requires the deployment's
 * internal token - a caller holding that is already inside the trust boundary,
 * and forging a bucket key is the least of what it could do.
 *
 * `X-Forwarded-For` and `X-Real-IP` are therefore ignored here. An inbound one at
 * this process is, by topology, either absent or attacker-shaped.
 *
 * ## Fail-safe direction
 *
 * With nothing vouched for, every caller shares {@link UNKNOWN_CLIENT_ADDRESS}.
 * That is the coarse failure (one global bucket), never the open one (a bucket
 * per request), and it is what a deployment with no ingress - the local Compose
 * quickstart, say - gets.
 *
 * ## Privacy (SEC-13)
 *
 * The value is a rate-limit bucket key and nothing else: never logged, never a
 * span attribute (header capture is off in `@hono/otel` and no allowlist entry
 * names an address), never in a response body, never persisted.
 */

import type { Context } from "hono";

/** The wire name, identical on both sides of the BFF hop. */
export const CLIENT_ADDRESS_HEADER = "x-qcms-client-address";

/** The shared bucket used when no address was vouched for. */
export const UNKNOWN_CLIENT_ADDRESS = "unknown-ip";

/**
 * A ceiling on the bucket key. The portal already normalizes to an IP literal;
 * this bounds what an over-long header could do to the store's key space.
 */
const MAX_ADDRESS_LENGTH = 64;

/** The vouched client address, or the shared bucket. */
export function clientAddress(c: Context): string {
  const raw = c.req.header(CLIENT_ADDRESS_HEADER)?.trim();
  if (raw === undefined || raw === "" || raw.length > MAX_ADDRESS_LENGTH) {
    return UNKNOWN_CLIENT_ADDRESS;
  }
  return raw;
}
