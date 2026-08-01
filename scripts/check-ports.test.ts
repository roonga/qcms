import { describe, expect, it } from "vitest";

import { ALLOWED, exemption, portsIn, sanctionedPorts } from "./check-ports.mjs";

/**
 * Tests for the port gate itself (R8, ADR-37, issue #255).
 *
 * A gate is the one place where a false negative is worse than a false positive: a
 * missed violation is invisible, because the run prints "OK" and nobody looks again.
 * So the exemption matcher gets its own tests, and the substring case below is the
 * one that matters - it was a real defect (`file.includes(rule.file)`) found in
 * review, and it fails against that implementation.
 */

/** An entry that really is exempt, used as the anchor for the near-miss cases. */
const ANCHOR = ALLOWED[0];

describe("exemption matching", () => {
  it("exempts the exact repo-relative path it names", () => {
    expect(ANCHOR).toBeDefined();
    expect(exemption(ANCHOR!.file, ANCHOR!.value)).toBe(ANCHOR!.why);
  });

  it("does not exempt a file that merely CONTAINS an allowlisted path", () => {
    // The review finding. With `file.includes(rule.file)` every one of these is
    // silently waved through and the gate still reports no findings, which is the
    // failure mode a gate exists to prevent. `docs/PORTS.md` may carry 4318; a
    // backup, a generated copy, or a vendored tree that happens to sit under a
    // matching prefix may not.
    for (const impostor of [
      `${ANCHOR!.file}.bak`,
      `${ANCHOR!.file}.orig`,
      `vendor/${ANCHOR!.file}`,
      `third_party/mirror/${ANCHOR!.file}`,
    ]) {
      expect(exemption(impostor, ANCHOR!.value)).toBeUndefined();
    }
  });

  it("does not exempt a suffix match either, only the exact path", () => {
    // Stated explicitly because suffix was the documented (but unimplemented)
    // behaviour, and "same basename somewhere else" is exactly the case an
    // exemption must not silently cover.
    expect(exemption(`packages/legacy/${ANCHOR!.file}`, ANCHOR!.value)).toBeUndefined();
  });

  it("does not exempt a different port in an allowlisted file", () => {
    // An exemption is for one port in one file, never a blanket pass for the file.
    expect(exemption(ANCHOR!.file, ANCHOR!.value + 1)).toBeUndefined();
  });

  it("keeps every allowlist entry a plain repo-relative path", () => {
    // With exact matching, a leading `./` or `/` would silently never match and the
    // entry would look present while doing nothing.
    for (const rule of ALLOWED) {
      expect(rule.file.startsWith("/")).toBe(false);
      expect(rule.file.startsWith("./")).toBe(false);
      expect(rule.why.length).toBeGreaterThan(0);
    }
  });
});

describe("port detection", () => {
  it("finds a port where the syntax says it is one", () => {
    const found = portsIn(
      ['const url = "http://localhost:9999/x";', "  PORTAL_PORT = 8888", "run --port 7777"].join(
        "\n",
      ),
    );
    // Deduplicated: one number can match more than one pattern (`--port 7777` is
    // both the flag form and the prose form), which is fine - the gate reports a
    // finding either way.
    expect([...new Set(found.map((entry) => entry.port))].sort()).toEqual([7777, 8888, 9999]);
  });

  it("ignores four-digit numbers that are not ports", () => {
    // The gate deliberately does not scan for bare numbers: years, byte caps,
    // timeouts and pixel sizes are everywhere, and a gate that fired on those would
    // be switched off within a week.
    expect(
      portsIn(
        ["const YEAR = 2026;", "timeout: 60000,", "width: 1280,", "support: 8080"].join("\n"),
      ),
    ).toEqual([]);
  });

  it("sanctions both blocks for every seat, and nothing else", () => {
    const sanctioned = sanctionedPorts();
    expect(sanctioned.has(7000)).toBe(true);
    expect(sanctioned.has(17_000)).toBe(true);
    expect(sanctioned.has(7100)).toBe(true);
    expect(sanctioned.has(17_940)).toBe(true);
    for (const stale of [3100, 3200, 4010, 4319]) expect(sanctioned.has(stale)).toBe(false);
  });
});
