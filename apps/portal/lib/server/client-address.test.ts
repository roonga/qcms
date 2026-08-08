/**
 * The BFF's client-address trust model (issue #341).
 *
 * Two properties, and the second is the one that matters. It is easy to make the
 * API tell respondents apart; it is easy in a way that hands every respondent a
 * bucket of their choosing. So alongside "different clients get different
 * addresses" every case here also asserts that a forged inbound prefix does not
 * move the answer.
 *
 * Against the pre-fix code all of this is vacuous: `baseHeaders()` sent no
 * address at all, so there was nothing to resolve and nothing to forge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_ADDRESS_HEADER,
  FORWARDED_FOR_HEADER,
  TRUSTED_PROXY_HOPS_VAR,
  resolveClientAddress,
  trustedProxyHops,
} from "./client-address";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("wire contract", () => {
  it("names the vouched header and the inbound header distinctly", () => {
    expect(CLIENT_ADDRESS_HEADER).toBe("x-qcms-client-address");
    expect(FORWARDED_FOR_HEADER).toBe("x-forwarded-for");
    expect(CLIENT_ADDRESS_HEADER).not.toBe(FORWARDED_FOR_HEADER);
  });
});

describe("trustedProxyHops", () => {
  it("defaults to one trusted proxy, which is both shipped ingress recipes", () => {
    expect(trustedProxyHops()).toBe(1);
  });

  it("accepts an explicit count, including 0 for 'trust no forwarded header'", () => {
    vi.stubEnv(TRUSTED_PROXY_HOPS_VAR, "2");
    expect(trustedProxyHops()).toBe(2);
    vi.stubEnv(TRUSTED_PROXY_HOPS_VAR, "0");
    expect(trustedProxyHops()).toBe(0);
  });

  it("refuses to run on a malformed value rather than silently defaulting", () => {
    for (const bad of ["one", "-1", "1.5", "99"]) {
      vi.stubEnv(TRUSTED_PROXY_HOPS_VAR, bad);
      expect(() => trustedProxyHops()).toThrow(TRUSTED_PROXY_HOPS_VAR);
    }
  });

  it("does not echo the offending value in the error (SEC-8 habit)", () => {
    vi.stubEnv(TRUSTED_PROXY_HOPS_VAR, "not-a-number-at-all");
    let message = "";
    try {
      trustedProxyHops();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(TRUSTED_PROXY_HOPS_VAR);
    expect(message).not.toContain("not-a-number-at-all");
  });
});

describe("resolveClientAddress: one trusted proxy (Recipes A and B)", () => {
  it("Recipe A - Caddy SETS the header, so the single entry is the client", () => {
    // `header_up X-Forwarded-For {remote_host}` replaces whatever arrived.
    expect(resolveClientAddress("203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("distinguishes two respondents that share one bucket today", () => {
    const first = resolveClientAddress("203.0.113.7", 1);
    const second = resolveClientAddress("198.51.100.22", 1);
    expect(first).toBe("203.0.113.7");
    expect(second).toBe("198.51.100.22");
    expect(first).not.toBe(second);
  });

  it("Recipe B - an appending load balancer, so the RIGHTMOST entry is the client", () => {
    expect(resolveClientAddress("198.51.100.22, 203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("ignores a forged prefix: the forged value never becomes the bucket", () => {
    const honest = resolveClientAddress("203.0.113.7", 1);
    // The attacker sends `X-Forwarded-For: 10.0.0.1` and the proxy appends its peer.
    const forged = resolveClientAddress("10.0.0.1, 203.0.113.7", 1);
    expect(forged).toBe(honest);
    expect(forged).not.toBe("10.0.0.1");
  });

  it("ignores a forged chain of any length, so buckets cannot be rotated", () => {
    const rotated = ["10.0.0.1", "10.0.0.2", "10.0.0.3"].map((forged) =>
      resolveClientAddress(`${forged}, 203.0.113.7`, 1),
    );
    expect(new Set(rotated)).toEqual(new Set(["203.0.113.7"]));
    expect(resolveClientAddress("1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7", 1)).toBe("203.0.113.7");
  });
});

describe("resolveClientAddress: other hop counts", () => {
  it("counts from the right, so two trusted proxies skip the nearest entry", () => {
    expect(resolveClientAddress("10.0.0.1, 203.0.113.7, 192.0.2.9", 2)).toBe("203.0.113.7");
  });

  it("yields nothing when no proxy is trusted (0 restores the shared bucket)", () => {
    expect(resolveClientAddress("203.0.113.7", 0)).toBeUndefined();
  });

  it("yields nothing when the chain is shorter than the declared trusted path", () => {
    // Declared two proxies, one entry arrived: the deployment is not the shape the
    // operator described, so nothing in the chain is known to be proxy-written.
    expect(resolveClientAddress("203.0.113.7", 2)).toBeUndefined();
  });

  it("yields nothing with no header at all", () => {
    expect(resolveClientAddress(null, 1)).toBeUndefined();
    expect(resolveClientAddress(undefined, 1)).toBeUndefined();
    expect(resolveClientAddress("", 1)).toBeUndefined();
    expect(resolveClientAddress("  ,  ", 1)).toBeUndefined();
  });
});

describe("resolveClientAddress: normalization", () => {
  it("keeps IPv4 and IPv6 literals, case-folded", () => {
    expect(resolveClientAddress("203.0.113.7", 1)).toBe("203.0.113.7");
    expect(resolveClientAddress("2001:DB8::1", 1)).toBe("2001:db8::1");
    expect(resolveClientAddress("::1", 1)).toBe("::1");
  });

  it("strips a port, so one client cannot get a bucket per connection", () => {
    expect(resolveClientAddress("203.0.113.7:51234", 1)).toBe("203.0.113.7");
    expect(resolveClientAddress("203.0.113.7:51235", 1)).toBe("203.0.113.7");
    expect(resolveClientAddress("[2001:db8::1]:443", 1)).toBe("2001:db8::1");
  });

  it("drops values that are not address-shaped (fail to the shared bucket)", () => {
    expect(resolveClientAddress("not-an-address", 1)).toBeUndefined();
    expect(resolveClientAddress("999.1.1.1", 1)).toBeUndefined();
    expect(resolveClientAddress("[2001:db8::1", 1)).toBeUndefined();
    expect(resolveClientAddress("x".repeat(200), 1)).toBeUndefined();
  });

  it("trims surrounding whitespace on the selected entry", () => {
    expect(resolveClientAddress("10.0.0.1 ,   203.0.113.7  ", 1)).toBe("203.0.113.7");
  });
});
