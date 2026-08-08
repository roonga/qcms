/**
 * The client address the BFF vouches for (issue #341).
 *
 * ## The problem
 *
 * The API's respondent rate limiters key on a client address, and R2 makes this
 * BFF the only path to the API. Until now `baseHeaders()` built its request
 * headers from scratch and carried no address at all, so every respondent in a
 * deployment landed in the API's single `unknown-ip` bucket: what reads as
 * "20 session starts per IP per hour" was 20 for the whole deployment.
 *
 * ## Why the obvious fix is worse than the bug
 *
 * Forwarding the inbound `X-Forwarded-For` verbatim would turn a uselessly
 * global control into a forgeable one, which is strictly worse: a caller that
 * picks its own header value picks its own bucket, and per-IP limiting stops
 * existing rather than merely being coarse. `X-Forwarded-For` is not a fact, it
 * is a list of claims, and only the entries written by proxies the operator
 * runs are worth anything.
 *
 * ## The rule: count trusted hops from the RIGHT
 *
 * Each proxy on the path appends the address of the peer it accepted the
 * connection from, so the rightmost entry was written by the nearest trusted
 * proxy and everything to its left is either a farther proxy or text the client
 * supplied. With `H` trusted proxies between the internet and this app, the
 * client address is therefore the `H`-th entry counting from the right, and no
 * amount of client-supplied padding on the left can move it.
 *
 * `H` is {@link trustedProxyHops} (`QCMS_PORTAL_TRUSTED_PROXY_HOPS`, default
 * `1`), and `1` is correct for both ingress recipes QCMS ships
 * (`docs/deploy-ingress.md`):
 *
 * - **Recipe A (Caddy overlay).** `docker/Caddyfile` sets - never appends -
 *   `X-Forwarded-For {remote_host}`, so the chain this app receives is exactly
 *   one entry, the peer address Caddy accepted. Rightmost is the client.
 * - **Recipe B (ECS + ALB).** An ALB appends the connection's source address to
 *   whatever arrived, so the chain is `<anything the client sent>, <client>`.
 *   Rightmost is again the client, and the forged prefix is ignored.
 * - **The enterprise split-mount topology** (`docs/deploy-enterprise.md`)
 *   changes the API's instance count, not the ingress in front of the portal,
 *   so it is whichever of A or B the operator chose.
 *
 * Raising `H` past the number of proxies that actually exist is the one
 * dangerous misconfiguration and cannot be detected from inside the process:
 * the resolver reads into client-supplied territory and per-IP limiting becomes
 * bypassable. Setting it too low is safe but coarse (respondents get bucketed by
 * a proxy's egress address). `0` means "trust no forwarded header", which
 * restores the single shared bucket deliberately.
 *
 * ## The hop to the API is a separate assertion
 *
 * This module does NOT forward `X-Forwarded-For` onward. The API has no way to
 * know how many proxies sit in front of the portal, so re-deriving the address
 * there would just move the ambiguity. Instead the resolved value is asserted on
 * {@link CLIENT_ADDRESS_HEADER}, a header that means "the BFF vouched for this",
 * and it travels on the SEC-4 internal-token channel: forging it requires the
 * deployment's internal token, which is already total compromise.
 *
 * ## Privacy (SEC-13)
 *
 * A client address is personal data. It is used as a rate-limit bucket key and
 * for nothing else: it is never logged, never set as a span attribute (the SEC-13
 * allowlists name no address attribute, and header capture is off in both apps),
 * never returned to a browser, and never persisted. It lives in the rate-limit
 * store for the length of one window.
 */

import { headers } from "next/headers";

/** The wire name the BFF vouches on, identical on both sides of the hop. */
export const CLIENT_ADDRESS_HEADER = "x-qcms-client-address";

/** The inbound header the ingress writes. Read here, never forwarded onward. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** The knob, as a name, so tests and the env reference agree on the spelling. */
export const TRUSTED_PROXY_HOPS_VAR = "QCMS_PORTAL_TRUSTED_PROXY_HOPS";

/** One trusted proxy: both shipped ingress recipes. */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * A sanity ceiling. Nothing legitimate stacks eight L7 proxies, and every extra
 * hop is one more entry an attacker would like the resolver to reach into.
 */
const MAX_TRUSTED_PROXY_HOPS = 8;

/** Longest textual IPv6 address plus a zone id, with room to spare. */
const MAX_ADDRESS_LENGTH = 64;

/** A dotted quad. Bounded quantifiers only (no super-linear backtracking). */
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** A dotted quad with a `:port` suffix, which some proxies emit. */
const IPV4_WITH_PORT = /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

/** The character set an IPv6 literal (optionally zoned, or IPv4-mapped) uses. */
const IPV6_CHARS = /^[0-9a-f:.%]+$/;

/**
 * How many proxies the operator runs between the internet and this app.
 *
 * A set-but-unparseable value throws rather than falling back to the default: a
 * security control whose tuning is a typo should refuse to run, not quietly
 * enforce something else. The value is not echoed in the message (SEC-8 habit -
 * configuration errors name the variable, never its contents).
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
 * Canonical form of one chain entry, or `undefined` when it is not address-shaped.
 *
 * Ports are stripped rather than tolerated: a per-connection source port would
 * give every request its own bucket, which is the same unlimited outcome as a
 * forgeable header arrived at by accident. Anything that survives neither check
 * yields `undefined`, which the caller turns into the shared bucket - fail-safe
 * in the one direction that matters.
 */
function normalizeAddress(raw: string): string | undefined {
  let value = raw.toLowerCase();
  if (value.startsWith("[")) {
    // `[2001:db8::1]` or `[2001:db8::1]:443`
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
 * The client address a chain of `hops` trusted proxies vouches for, or
 * `undefined` when there is nothing worth vouching for.
 *
 * `undefined` when: no trusted proxy is declared, no header arrived, the chain is
 * shorter than the declared trusted path (the deployment is not the shape the
 * operator described, so no entry in it was necessarily written by a proxy), or
 * the selected entry is not address-shaped.
 *
 * Exported for its unit test: this is the whole security property in six lines
 * and it needs no server to assert.
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
 * This request's vouched client address, or `undefined` outside a request scope.
 *
 * Deliberately has no fallback: with no trustworthy address the API's limiters
 * use their own shared bucket, which is coarse but is never a per-request bucket.
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
