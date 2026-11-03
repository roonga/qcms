import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authRequestHeaders } from "./api.ts";
import { CLIENT_ADDRESS_HEADER } from "./client-address.ts";
import { INTERNAL_TOKEN_HEADER } from "./config.ts";

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

    expect(built.get("x-forwarded-for")).toBeNull();
    expect(built.get("x-real-ip")).toBeNull();
  });

  it("does NOT let a forged prefix move the bucket", () => {
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
