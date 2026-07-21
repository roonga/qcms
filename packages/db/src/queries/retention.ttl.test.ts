import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANONYMOUS_SESSION_TTL_MS,
  DEFAULT_SESSION_TTL,
  sessionExpiresAt,
} from "./retention.js";

describe("session TTL policy", () => {
  it("documents the anonymous default as 24 hours", () => {
    expect(DEFAULT_ANONYMOUS_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(DEFAULT_SESSION_TTL.anonymousTtlMs).toBe(DEFAULT_ANONYMOUS_SESSION_TTL_MS);
  });

  it("anonymous expiry is now + TTL", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = sessionExpiresAt({ accessMode: "anonymous", now });
    expect(expiresAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("anonymous expiry honours a custom TTL config", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = sessionExpiresAt({
      accessMode: "anonymous",
      now,
      config: { anonymousTtlMs: 60 * 60 * 1000 },
    });
    expect(expiresAt.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("secure-link expiry is the link's own expiry when it is within the TTL ceiling", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    // +1h < 24h default TTL, so the link expiry wins.
    const linkExpiresAt = new Date("2026-01-01T01:00:00.000Z");
    const expiresAt = sessionExpiresAt({ accessMode: "secure_link", now, linkExpiresAt });
    expect(expiresAt).toEqual(linkExpiresAt);
  });

  it("secure-link expiry is clamped to now + TTL when the link outlives the TTL ceiling", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    // +4.5 days > 24h default TTL: the TTL ceiling wins, not the raw link expiry.
    const linkExpiresAt = new Date("2026-01-05T12:00:00.000Z");
    const expiresAt = sessionExpiresAt({ accessMode: "secure_link", now, linkExpiresAt });
    expect(expiresAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("secure-link expiry honours a custom TTL ceiling", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const linkExpiresAt = new Date("2026-01-05T12:00:00.000Z");
    // A 1h TTL config clamps the multi-day link down to now + 1h.
    const expiresAt = sessionExpiresAt({
      accessMode: "secure_link",
      now,
      linkExpiresAt,
      config: { anonymousTtlMs: 60 * 60 * 1000 },
    });
    expect(expiresAt.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("throws when a secure-link session has no link expiry", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(() => sessionExpiresAt({ accessMode: "secure_link", now })).toThrow(/linkExpiresAt/);
  });
});
