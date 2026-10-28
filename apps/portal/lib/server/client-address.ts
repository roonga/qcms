/**
 * The client address the BFF vouches for, which the API's respondent rate limiters key
 * on.
 *
 * `X-Forwarded-For` is a list of claims rather than a fact, so forwarding it verbatim
 * would make a coarse control a forgeable one. The rule is to count trusted hops from
 * the right: each proxy appends the peer it accepted the connection from, so with `H`
 * trusted proxies the client address is the `H`-th entry from the right and no
 * client-supplied padding on the left can move it. `docs/deploy-ingress.md` records why
 * `1` is right for both shipped recipes.
 *
 * Raising `H` past the number of proxies that exist is the one dangerous
 * misconfiguration and cannot be detected from inside the process: the resolver reads
 * into client-supplied territory and per-IP limiting becomes bypassable. Too low is safe
 * but coarse, and `0` restores a single shared bucket deliberately.
 *
 * The inbound header is never forwarded onward, because the API cannot know how many
 * proxies sit in front of the portal. The resolved value is asserted on
 * {@link CLIENT_ADDRESS_HEADER} instead, which travels on the SEC-4 internal-token
 * channel.
 *
 * `apps/admin/lib/server/client-address.ts` is a twin carrying the same rule for the
 * authoring hostname. Change the rule here and you must change it there; the two test
 * suites assert the same chain cases.
 *
 * SEC-13: the address is a rate-limit bucket key and nothing else. It is never logged,
 * never a span attribute, never returned to a browser and never persisted.
 */

import { headers } from "next/headers";

export const CLIENT_ADDRESS_HEADER = "x-qcms-client-address";

/** Read here, never forwarded onward. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** As a name, so the tests and the env reference agree on the spelling. */
export const TRUSTED_PROXY_HOPS_VAR = "QCMS_PORTAL_TRUSTED_PROXY_HOPS";

const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * A sanity ceiling: nothing legitimate stacks eight L7 proxies, and every extra hop is
 * one more entry an attacker would like the resolver to reach into.
 */
const MAX_TRUSTED_PROXY_HOPS = 8;

const MAX_ADDRESS_LENGTH = 64;

/** Bounded quantifiers only, so there is no super-linear backtracking. */
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** Some proxies emit a `:port` suffix. */
const IPV4_WITH_PORT = /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

const IPV6_CHARS = /^[0-9a-f:.%]+$/;

/**
 * An unparseable value throws rather than falling back to the default: a security
 * control whose tuning is a typo should refuse to run rather than quietly enforce
 * something else. The value is not echoed in the message (SEC-8).
 */
export function trustedProxyHops(): number {
  const raw = process.env.QCMS_PORTAL_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRUSTED_PROXY_HOPS;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TRUSTED_PROXY_HOPS) {
    throw new Error(
      `${TRUSTED_PROXY_HOPS_VAR} must be a whole number from 0 to ${String(MAX_TRUSTED_PROXY_HOPS)}`,
    );
  }
  return parsed;
}

/**
 * Ports are stripped rather than tolerated: a per-connection source port would give
 * every request its own bucket, which is the same unlimited outcome as a forgeable
 * header reached by accident. Anything unrecognised yields `undefined`, which the caller
 * turns into the shared bucket.
 */
function normalizeAddress(raw: string): string | undefined {
  let value = raw.toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return undefined;
    value = value.slice(1, end);
  } else if (IPV4_WITH_PORT.test(value)) {
    value = value.slice(0, value.lastIndexOf(":"));
  }
  if (value === "" || value.length > MAX_ADDRESS_LENGTH) return undefined;
  if (IPV4.test(value)) {
    return value.split(".").every((octet) => Number(octet) <= 255) ? value : undefined;
  }
  return value.includes(":") && IPV6_CHARS.test(value) ? value : undefined;
}

/**
 * `undefined` when no trusted proxy is declared, no header arrived, the chain is shorter
 * than the declared trusted path, or the selected entry is not address-shaped. A short
 * chain means the deployment is not the shape the operator described, so no entry in it
 * was necessarily written by a proxy.
 */
export function resolveClientAddress(
  forwardedFor: string | null | undefined,
  hops: number,
): string | undefined {
  if (hops < 1 || forwardedFor === null || forwardedFor === undefined) return undefined;
  const chain = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (chain.length < hops) return undefined;
  const entry = chain[chain.length - hops];
  return entry === undefined ? undefined : normalizeAddress(entry);
}

/**
 * No fallback: with no trustworthy address the API's limiters use their own shared
 * bucket, which is coarse but never a per-request bucket.
 */
export async function currentClientAddress(): Promise<string | undefined> {
  const hops = trustedProxyHops();
  if (hops < 1) return undefined;
  try {
    const store = await headers();
    return resolveClientAddress(store.get(FORWARDED_FOR_HEADER), hops);
  } catch {
    // `headers()` throws outside a request (a unit test, or a module-scope call).
    return undefined;
  }
}
