import { describe, expect, it } from "vitest";

import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  backoffDelayMs,
  computeBackoff,
} from "./outbox.js";

const MIN = 60_000;

describe("outbox backoff schedule", () => {
  it("follows 1m, 5m, 25m, 125m then caps at 6h", () => {
    expect(backoffDelayMs(1)).toBe(1 * MIN);
    expect(backoffDelayMs(2)).toBe(5 * MIN);
    expect(backoffDelayMs(3)).toBe(25 * MIN);
    expect(backoffDelayMs(4)).toBe(125 * MIN);
    // 5^4 = 625m > 360m → capped at 6h.
    expect(backoffDelayMs(5)).toBe(OUTBOX_BACKOFF_CAP_MS);
    expect(backoffDelayMs(9)).toBe(OUTBOX_BACKOFF_CAP_MS);
  });

  it("first retry uses the base delay", () => {
    expect(backoffDelayMs(1)).toBe(OUTBOX_BACKOFF_BASE_MS);
  });

  it("never exceeds the cap", () => {
    for (let attempts = 1; attempts <= 20; attempts++) {
      expect(backoffDelayMs(attempts)).toBeLessThanOrEqual(OUTBOX_BACKOFF_CAP_MS);
    }
  });
});

describe("computeBackoff dead-lettering", () => {
  const from = new Date("2026-07-20T00:00:00.000Z");

  it("schedules the next attempt and does not dead-letter before the max", () => {
    for (let attempts = 1; attempts < OUTBOX_MAX_ATTEMPTS; attempts++) {
      const result = computeBackoff(attempts, from);
      expect(result.deadLetteredAt).toBeNull();
      expect(result.nextAttemptAt.getTime()).toBe(from.getTime() + backoffDelayMs(attempts));
    }
  });

  it("dead-letters once attempts reach the max", () => {
    const result = computeBackoff(OUTBOX_MAX_ATTEMPTS, from);
    expect(result.deadLetteredAt).toEqual(from);
  });

  it("stays dead-lettered past the max", () => {
    expect(computeBackoff(OUTBOX_MAX_ATTEMPTS + 3, from).deadLetteredAt).toEqual(from);
  });
});
