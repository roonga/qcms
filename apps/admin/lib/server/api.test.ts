import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authRequestHeaders } from "./api.ts";
import { INTERNAL_TOKEN_HEADER } from "./config.ts";

/**
 * The auth hop's header contract (task 056).
 *
 * Two properties, both security-relevant and both cheap to assert without a server:
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
        "x-forwarded-for",
      ].sort(),
    );
    expect(built.get(INTERNAL_TOKEN_HEADER)).toBe(TOKEN);
    expect(built.get("cookie")).toBe("qcms_admin.session_token=abc");
  });

  it("carries only the channel token when there is no browser request", () => {
    expect(namesOf(authRequestHeaders(undefined))).toEqual([INTERNAL_TOKEN_HEADER]);
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
