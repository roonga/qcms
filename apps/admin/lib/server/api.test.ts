import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authRequestHeaders } from "./api.ts";
import { CLIENT_ADDRESS_HEADER } from "./client-address.ts";
import { INTERNAL_TOKEN_HEADER } from "./config.ts";

/**
 * The auth hop's header contract (task 056; issue #374).
 *
 * Three properties, all security-relevant and all cheap to assert without a server:
 *
 * 1. **The allowlist holds.** Only the named headers cross from the browser to the API,
 *    so a request the admin makes on the browser's behalf cannot carry `host`,
 *    `content-length` or anything else that describes the wrong hop.
 * 2. **`Origin: null` is replaced with this app's own origin, and a real origin never
 *    is.** This app sends `Referrer-Policy: no-referrer`, so a browser posting a form
 *    here sends `Origin: null` and no `Referer`, which better-auth refuses `403
 *    MISSING_OR_NULL_ORIGIN`. The substitution is what makes the no-JS auth flow work
 *    at all, and its whole safety argument is that it is conditional - see
 *    `forwardedOrigin` in `api.ts`. A test that only covered the substitution would pass
 *    for an unconditional one, so the foreign-origin case is asserted beside it.
 * 3. **The client address is asserted, never relayed.** `x-forwarded-for` and
 *    `x-real-ip` are the headers SEC-1's sign-in throttle used to key on, and the
 *    browser writes both, so relaying them let a caller choose its own backoff bucket.
 *    They no longer cross the hop at all; what crosses is the one address this app
 *    resolved. The end of that story - that better-auth's limiter now moves with the
 *    vouched header and not with a forged one - is asserted against the real library in
 *    `apps/api/src/features/auth/sign-in-throttle.test.ts`.
 */

const ADMIN_ORIGIN = "https://admin.example.test";
const TOKEN = "synthetic-internal-token-for-this-test-000";

beforeEach(() => {
  process.env.QCMS_ADMIN_BASE_URL = ADMIN_ORIGIN;
  process.env.QCMS_INTERNAL_TOKEN = TOKEN;
});

afterEach(() => {
  delete process.env.QCMS_ADMIN_BASE_URL;
  delete process.env.QCMS_INTERNAL_TOKEN;
});

/** Every header name the built request carries, sorted. */
function namesOf(headers: Headers): string[] {
  const names: string[] = [];
  headers.forEach((_value, name) => names.push(name));
  return names.sort();
}

describe("the forwarded header allowlist", () => {
  it("carries the channel token and drops everything not on the list", () => {
    const from = new Headers({
      cookie: "qcms_admin.session_token=abc",
      "user-agent": "Mozilla/5.0 (test)",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.7",
      // None of these may cross: they describe the browser-to-admin hop.
      host: "admin.example.test",
      "content-length": "83",
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-host": "admin.example.test",
      authorization: "Bearer not-ours",
    });
    const built = authRequestHeaders(from);
    expect(namesOf(built)).toEqual(
      [
        "cookie",
        "origin",
        "sec-fetch-site",
        "user-agent",
        INTERNAL_TOKEN_HEADER,
        CLIENT_ADDRESS_HEADER,
      ].sort(),
    );
    expect(built.get(INTERNAL_TOKEN_HEADER)).toBe(TOKEN);
    expect(built.get("cookie")).toBe("qcms_admin.session_token=abc");
  });

  it("carries only the channel token when there is no browser request", () => {
    expect(namesOf(authRequestHeaders(undefined))).toEqual([INTERNAL_TOKEN_HEADER]);
  });
});

describe("the client address the throttle keys on (issue #374)", () => {
  const forwarded = (chain: string): Headers =>
    authRequestHeaders(
      new Headers(chain === "" ? {} : { "x-forwarded-for": chain, "x-real-ip": "10.9.9.9" }),
    );

  it("vouches for the address the ingress wrote, and relays neither raw header", () => {
    const built = forwarded("203.0.113.7");
    expect(built.get(CLIENT_ADDRESS_HEADER)).toBe("203.0.113.7");
    // The API must not be able to re-derive an address from a client-written list.
    expect(built.get("x-forwarded-for")).toBeNull();
    expect(built.get("x-real-ip")).toBeNull();
  });

  it("does NOT let a forged prefix move the bucket", () => {
    // The attacker sends its own chain; an appending proxy adds the peer it accepted.
    const built = forwarded("10.0.0.1, 203.0.113.7");
    expect(built.get(CLIENT_ADDRESS_HEADER)).toBe("203.0.113.7");
    expect(built.get(CLIENT_ADDRESS_HEADER)).not.toBe("10.0.0.1");
  });

  it("keeps two genuinely different clients in two buckets", () => {
    expect(forwarded("203.0.113.7").get(CLIENT_ADDRESS_HEADER)).toBe("203.0.113.7");
    expect(forwarded("198.51.100.22").get(CLIENT_ADDRESS_HEADER)).toBe("198.51.100.22");
  });

  it("omits the header when nothing trustworthy arrived (shared bucket, not a free one)", () => {
    expect(forwarded("").has(CLIENT_ADDRESS_HEADER)).toBe(false);
  });

  it("omits the header when the operator trusts no proxy", () => {
    vi.stubEnv("QCMS_ADMIN_TRUSTED_PROXY_HOPS", "0");
    expect(forwarded("203.0.113.7").has(CLIENT_ADDRESS_HEADER)).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("the Origin header this app presents to better-auth", () => {
  it("substitutes its own origin for the literal `null` a no-referrer form POST sends", () => {
    const built = authRequestHeaders(new Headers({ origin: "null" }));
    expect(built.get("origin")).toBe(ADMIN_ORIGIN);
  });

  it("substitutes its own origin when the browser sent none at all", () => {
    const built = authRequestHeaders(new Headers({ cookie: "x=1" }));
    expect(built.get("origin")).toBe(ADMIN_ORIGIN);
  });

  it("forwards a FOREIGN origin unchanged, so better-auth still refuses it", () => {
    const built = authRequestHeaders(new Headers({ origin: "https://evil.example" }));
    expect(built.get("origin")).toBe("https://evil.example");
  });

  it("forwards this app's own origin unchanged when the browser did send it", () => {
    const built = authRequestHeaders(new Headers({ origin: ADMIN_ORIGIN }));
    expect(built.get("origin")).toBe(ADMIN_ORIGIN);
  });
});
