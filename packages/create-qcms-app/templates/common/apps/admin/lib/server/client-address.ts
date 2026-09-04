/**
 * The client address this BFF vouches for (issue #374).
 *
 * ## The problem
 *
 * better-auth's per-IP sign-in throttling (SEC-1) keys on an address it resolves
 * from a request header, and R2 makes this BFF the only path to the API. Until now
 * `authRequestHeaders()` forwarded the browser's own `X-Forwarded-For` (and
 * `X-Real-IP`) verbatim, so the value the throttle keyed on was whatever the caller
 * chose to send. `X-Forwarded-For` is not a fact, it is a list of claims: a caller
 * that rotates it picks a fresh bucket every attempt and per-IP backoff stops
 * existing. Measured, not theorized - see
 * `apps/api/src/features/auth/sign-in-throttle.test.ts`, which drives the real library
 * and shows five rotated values buying five fresh allowances.
 *
 * ## Why dropping the header is not the fix either
 *
 * With no address at all better-auth resolves none and puts every caller in one
 * shared `no-trusted-ip` bucket: three sign-in attempts per ten seconds for the whole
 * deployment, which any caller can hold exhausted. That converts a forgeable limiter
 * into a lockout lever. The address has to be replaced, not removed.
 *
 * ## The rule: count trusted hops from the RIGHT
 *
 * This is the portal's model (issue #341), applied to the authoring app. Each proxy
 * on the path appends the address of the peer it accepted the connection from, so the
 * rightmost entry was written by the nearest trusted proxy and everything to its left
 * is either a farther proxy or text the client supplied. With `H` trusted proxies
 * between the internet and this app, the client address is the `H`-th entry counting
 * from the right, and no amount of client-supplied padding on the left can move it.
 *
 * `H` is {@link trustedProxyHops} (`QCMS_ADMIN_TRUSTED_PROXY_HOPS`, default `1`), and
 * `1` is correct for both ingress recipes QCMS ships (`docs/deploy-ingress.md`),
 * because both front this app exactly as they front the portal:
 *
 * - **Recipe A (Caddy overlay).** The admin site block in `docker/Caddyfile` sets -
 *   never appends - `X-Forwarded-For {remote_host}`, the same line the portal's block
 *   carries, so the chain this app receives is exactly one entry.
 * - **Recipe B (ECS + ALB).** An ALB appends the connection's source address to
 *   whatever arrived, so the chain is `<anything the client sent>, <client>`.
 *   Rightmost is again the client.
 *
 * The count is a **separate knob from the portal's** because the two apps are two
 * hostnames and an operator may put a CDN or WAF in front of one and not the other;
 * one shared variable would force a wrong answer on whichever app is not the one it
 * was tuned for. Raising it past the number of proxies that actually exist is the one
 * dangerous misconfiguration and cannot be detected from inside the process. Setting
 * it too low is safe but coarse (admins get bucketed by a proxy's egress address).
 * `0` means "trust no forwarded header", which restores the single shared bucket
 * deliberately.
 *
 * ## Why this is a copy of `apps/portal/lib/server/client-address.ts`
 *
 * Deliberately, and it is the same call `config.ts` makes about `MIN_PASSWORD_LENGTH`
 * and `lib/i18n/en.ts` makes about shared copy: the portal and the admin are separate
 * deployables with no shared package between them, and the four `@qcms/*` packages are
 * the questionnaire kernel, the compiler, the database layer and the component
 * library - none is a home for a Next BFF's trust model, and minting a fifth
 * publishable package to hold forty lines is an architecture decision this fix is not
 * entitled to make. The semantics are the contract, and they are pinned on both sides:
 * `client-address.test.ts` here and in the portal assert the same chain cases, so a
 * change to one that is not made to the other shows up as a red test rather than as a
 * silent divergence. **Change one, change the other.**
 *
 * ## Privacy (SEC-13)
 *
 * A client address is personal data. Here it is a rate-limit bucket key: never logged,
 * never a span attribute (the SEC-13 allowlists name no address attribute and header
 * capture is off), never rendered. better-auth also stamps it on the session row it
 * creates, which is what it did before this change too - the difference is that the
 * stored value is now one the deployment vouched for rather than one the browser
 * asserted.
 */

/** The wire name the BFF vouches on, identical on both sides of the hop. */
export const CLIENT_ADDRESS_HEADER = "x-qcms-client-address";

/** The inbound header the ingress writes. Read here, never forwarded onward. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** The knob, as a name, so tests and the env reference agree on the spelling. */
export const TRUSTED_PROXY_HOPS_VAR = "QCMS_ADMIN_TRUSTED_PROXY_HOPS";

/** One trusted proxy: both shipped ingress recipes. */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * A sanity ceiling. Nothing legitimate stacks eight L7 proxies, and every extra hop is
 * one more entry an attacker would like the resolver to reach into.
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
 * security control whose tuning is a typo should refuse to run, not quietly enforce
 * something else. The value is not echoed in the message (SEC-8 habit - configuration
 * errors name the variable, never its contents).
 */
export function trustedProxyHops(): number {
  const raw = process.env.QCMS_ADMIN_TRUSTED_PROXY_HOPS;
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
 * Ports are stripped rather than tolerated: a per-connection source port would give
 * every request its own bucket, which is the same unlimited outcome as a forgeable
 * header arrived at by accident. Anything that survives neither check yields
 * `undefined`, which the caller turns into the shared bucket - fail-safe in the one
 * direction that matters.
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
 * The client address a chain of `hops` trusted proxies vouches for, or `undefined`
 * when there is nothing worth vouching for.
 *
 * `undefined` when: no trusted proxy is declared, no header arrived, the chain is
 * shorter than the declared trusted path (the deployment is not the shape the operator
 * described, so no entry in it was necessarily written by a proxy), or the selected
 * entry is not address-shaped.
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
 * The address this app vouches for on behalf of one inbound browser request.
 *
 * Synchronous and header-driven, where the portal's equivalent reads `next/headers`:
 * every caller here is already holding the browser's `Headers` (the auth route
 * handlers pass them to `authRequestHeaders`), so there is no request scope to look up
 * and no reason to make this async.
 *
 * Deliberately has no fallback: with no trustworthy address better-auth resolves none
 * and uses its own shared bucket, which is coarse but is never a per-request bucket.
 */
export function vouchedClientAddress(from: Headers): string | undefined {
  const hops = trustedProxyHops();
  if (hops < 1) return undefined;
  return resolveClientAddress(from.get(FORWARDED_FOR_HEADER), hops);
}
