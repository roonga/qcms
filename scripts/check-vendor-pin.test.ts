import { describe, expect, it } from "vitest";

import {
  EXEMPT,
  TRACKED_PREFIXES,
  assertionsIn,
  isExempt,
  resolvedVersions,
} from "./check-vendor-pin.mjs";

/**
 * Tests for the vendor-pin gate (issue #483).
 *
 * A gate is the one place a false negative costs more than a false positive: a missed
 * violation is invisible, because the run prints OK and nobody looks again. So the
 * matcher gets cases on both sides - the shapes this repo actually writes, and the
 * near misses that must not fire.
 *
 * **Every fixture interpolates its version rather than writing it inline**, so this
 * file scans cleanly under the gate it tests. `check-vendor-pin.mjs` avoids the same
 * trap by naming no literal version at all; a test file cannot, since the stale case
 * is the thing under test.
 */

/** A version the lockfile does not resolve, in the fixtures below. */
const STALE = "1.6.26";
/** Stands in for the resolved pin. */
const PINNED = "1.7.1";

describe("assertion matching", () => {
  it("matches the specifier shape, `name@version`", () => {
    expect(assertionsIn(`the pinned \`better-auth@${STALE}\` carries`)).toEqual([
      { pkg: "better-auth", version: STALE, line: 1 },
    ]);
  });

  it("matches the prose shape, `name version`", () => {
    expect(assertionsIn(`better-auth ${STALE}, the pinned version, resolves this`)).toEqual([
      { pkg: "better-auth", version: STALE, line: 1 },
    ]);
  });

  it("matches a possessive, which is how half the citations here are written", () => {
    expect(assertionsIn(`checked against better-auth ${STALE}'s source, not inferred`)).toEqual([
      { pkg: "better-auth", version: STALE, line: 1 },
    ]);
  });

  it("attributes a scoped package to itself, not to bare better-auth", () => {
    // The bare alternative sits inside the scoped name. If the boundary were wrong
    // this would report two hits, and the second would be checked against the wrong
    // package's resolved version.
    expect(assertionsIn(`and \`@better-auth/core@${STALE}\`'s env-impl computes`)).toEqual([
      { pkg: "@better-auth/core", version: STALE, line: 1 },
    ]);
  });

  it("reports the line number of each hit", () => {
    const text = ["intro", `better-auth ${STALE}`, "middle", `better-auth ${PINNED}`].join("\n");
    expect(assertionsIn(text).map((a) => a.line)).toEqual([2, 4]);
  });

  it("does not match a longer identifier that merely ends in the package name", () => {
    expect(assertionsIn(`not-better-auth ${STALE}`)).toEqual([]);
    expect(assertionsIn(`xbetter-auth@${STALE}`)).toEqual([]);
  });

  it("reads a longer version whole, never as the shorter one it starts with", () => {
    // `1.7.1` is a prefix of `1.7.11`. Without the trailing boundary this would report
    // an assertion of 1.7.1 and pass against a lockfile pinned to 1.7.1, silently
    // accepting prose that names a different version - the exact class of near miss
    // the gate exists to catch. With it, the whole version is read and compared.
    expect(assertionsIn(`better-auth ${PINNED}1`)).toEqual([
      { pkg: "better-auth", version: `${PINNED}1`, line: 1 },
    ]);
  });

  it("does not match a four-part version, which is not a version this lockfile writes", () => {
    // No prefix of `1.7.1.4` is a legitimate assertion, so reporting one would be a
    // false positive on text that is not a semver at all.
    expect(assertionsIn(`better-auth ${PINNED}.4`)).toEqual([]);
  });

  it("does not match a source citation that carries no version", () => {
    // The overwhelmingly common shape in this repo: a path plus a line number.
    expect(assertionsIn("`@better-auth/core/dist/types/init-options.d.mts:430,441`")).toEqual([]);
    expect(assertionsIn("better-auth resolves `enabled` at `dist/api/index.mjs:162-168`")).toEqual(
      [],
    );
  });

  it("does not match a package.json dependency range", () => {
    // A manifest range is a declaration, not an assertion about what resolved, and it
    // is not written in either matched shape.
    expect(assertionsIn(`"better-auth": "^${PINNED}"`)).toEqual([]);
  });
});

describe("lockfile resolution", () => {
  // The three key shapes pnpm 11 writes: an unquoted bare name in `packages:`, a
  // quoted scoped name, and a `snapshots:` key with a peer-dependency suffix.
  const lock = [
    "packages:",
    "",
    `  better-auth@${PINNED}:`,
    "    resolution: {integrity: sha512-abc}",
    "",
    `  '@better-auth/core@${PINNED}':`,
    "    resolution: {integrity: sha512-def}",
    "",
    "snapshots:",
    "",
    `  better-auth@${PINNED}(@opentelemetry/api@1.9.1)(kysely@0.29.4):`,
    "    dependencies:",
    `      '@better-auth/core': ${PINNED}`,
    "",
    `  '@better-auth/core@${PINNED}(@better-auth/utils@0.4.2)':`,
    "    dependencies:",
    "      '@better-auth/utils': 0.4.2",
  ].join("\n");

  it("reads the resolved version of each better-auth package", () => {
    const resolved = resolvedVersions(lock);
    expect([...(resolved.get("better-auth") ?? [])]).toEqual([PINNED]);
    expect([...(resolved.get("@better-auth/core") ?? [])]).toEqual([PINNED]);
  });

  it("ignores a nested dependency line, which is indented past a top-level key", () => {
    // `      '@better-auth/utils': 0.4.2` is a dependency edge, not a resolution, and
    // its version is not written in the `name@version` form the key uses. Reading one
    // as a resolution would make the gate accept versions no entry declares.
    expect(resolvedVersions(lock).has("@better-auth/utils")).toBe(false);
  });

  it("collects every resolution when a package appears at two versions", () => {
    const twice = [
      "packages:",
      "",
      `  '@better-auth/utils@0.4.2':`,
      `  '@better-auth/utils@0.5.0':`,
    ].join("\n");
    expect([...(resolvedVersions(twice).get("@better-auth/utils") ?? [])].sort()).toEqual([
      "0.4.2",
      "0.5.0",
    ]);
  });

  it("returns nothing for a lockfile with no better-auth in it", () => {
    // The `main()` guard depends on this: an empty map means the lockfile format moved
    // (or the dependency is gone), which must fail loudly rather than pass vacuously.
    expect(resolvedVersions("packages:\n\n  hono@4.13.0:\n").size).toBe(0);
  });
});

describe("record exemptions", () => {
  it("exempts a file under a record directory", () => {
    expect(isExempt("docs/features/061-forced-password-change.md")).toBe(true);
    expect(isExempt("plan/040-security-triage-input.md")).toBe(true);
  });

  it("exempts a record named as an exact file", () => {
    expect(isExempt("docs/RETRO.md")).toBe(true);
  });

  it("does not exempt the live documents this gate exists for", () => {
    for (const live of [
      "docs/SECURITY_DESIGN.md",
      "docs/DEVELOPER_GUIDE.md",
      "apps/api/src/features/auth/instance.ts",
      "apps/admin/lib/server/auth-api.ts",
      ".env.compose.example",
    ]) {
      expect(isExempt(live)).toBe(false);
    }
  });

  it("keeps every exemption a plain repo-relative path", () => {
    // A leading `./` or `/` would silently never match, leaving an entry that looks
    // present while doing nothing.
    for (const entry of EXEMPT) {
      expect(entry.startsWith("/")).toBe(false);
      expect(entry.startsWith("./")).toBe(false);
    }
  });

  it("names the package families it tracks", () => {
    expect(TRACKED_PREFIXES).toContain("better-auth");
    expect(TRACKED_PREFIXES).toContain("@better-auth/");
  });
});
