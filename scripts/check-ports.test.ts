import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ALLOWED, exemption, portsIn, sanctionedPorts } from "./check-ports.mjs";

const ANCHOR = ALLOWED[0];

describe("exemption matching", () => {
  it("exempts the exact repo-relative path it names", () => {
    expect(ANCHOR).toBeDefined();
    expect(exemption(ANCHOR!.file, ANCHOR!.value)).toBe(ANCHOR!.why);
  });

  it("does not exempt a file that merely CONTAINS an allowlisted path", () => {
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
    expect(exemption(`packages/legacy/${ANCHOR!.file}`, ANCHOR!.value)).toBeUndefined();
  });

  it("does not exempt a different port in an allowlisted file", () => {
    // An exemption is for one port in one file, never a blanket pass for the file.
    expect(exemption(ANCHOR!.file, ANCHOR!.value + 1)).toBeUndefined();
  });

  it("keeps every allowlist entry a plain repo-relative path", () => {
    // A leading `./` or `/` never matches, so the entry would look present while doing
    // nothing.
    for (const rule of ALLOWED) {
      expect(rule.file.startsWith("/")).toBe(false);
      expect(rule.file.startsWith("./")).toBe(false);
      expect(rule.why.length).toBeGreaterThan(0);
    }
  });

  it("keeps every allowlist entry one the scan can actually reach", () => {
    // A dead exemption reads as evidence the gate inspects that file. Replaying main()'s
    // own decision per entry is what stops the list drifting back.
    const sanctioned = sanctionedPorts();
    const dead = ALLOWED.filter((rule) => {
      if (!existsSync(rule.file)) return true;
      const found = portsIn(readFileSync(rule.file, "utf8"));
      return !found.some((hit) => hit.port === rule.value && !sanctioned.has(hit.port));
    }).map((rule) => `${rule.file}:${String(rule.value)}`);

    expect(dead).toEqual([]);
  });
});

/**
 * Interpolated, never written out in port syntax: the gate scans tracked files, so a
 * literal here would be a real finding in its own source and would need an exemption
 * on the gate's own test.
 */
const IN_URL = 9999;
const IN_ASSIGNMENT = 8888;
const IN_FLAG = 7777;

describe("port detection", () => {
  it("finds a port where the syntax says it is one", () => {
    const found = portsIn(
      [
        `const url = "http://localhost:${String(IN_URL)}/x";`,
        `  PORTAL_PORT = ${String(IN_ASSIGNMENT)}`,
        `run --port ${String(IN_FLAG)}`,
      ].join("\n"),
    );
    expect([...new Set(found.map((entry) => entry.port))].sort()).toEqual([
      IN_FLAG,
      IN_ASSIGNMENT,
      IN_URL,
    ]);
  });

  it("ignores four-digit numbers that are not ports", () => {
    // Bare numbers are deliberately not scanned: years, byte caps, timeouts and pixel
    // sizes are everywhere, and a gate firing on those gets switched off.
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
