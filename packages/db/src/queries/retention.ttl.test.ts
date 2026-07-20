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

  it("secure-link expiry is the link's own expiry, independent of now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const linkExpiresAt = new Date("2026-01-05T12:00:00.000Z");
    const expiresAt = sessionExpiresAt({ accessMode: "secure_link", now, linkExpiresAt });
    expect(expiresAt).toEqual(linkExpiresAt);
  });

  it("throws when a secure-link session has no link expiry", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(() => sessionExpiresAt({ accessMode: "secure_link", now })).toThrow(/linkExpiresAt/);
  });
});
