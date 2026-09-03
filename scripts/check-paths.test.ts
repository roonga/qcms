import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALLOWED, exemption, pathsIn, scanned } from "./check-paths.mjs";

/**
 * Tests for the machine-specific-path gate (issue #268).
 *
 * A gate is the one place a false negative costs more than a false positive: a missed
 * violation is invisible, because the run prints OK and nobody looks again. So the
 * fixtures are interpolated rather than written out, for the reason PR #265's lane gave
 * when it refused to allowlist its own test file: a blanket exemption inside the gate is
 * the hole the gate exists to close, and a literal machine path committed in this file
 * would demand one.
 */

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Path separators, built rather than typed, so this file carries no machine path. */
const SLASH = "/";
const BACKSLASH = String.fromCharCode(92);

/** One fixture per recognised shape, each assembled rather than written. */
const posixHome = `${SLASH}home${SLASH}dev${SLASH}src${SLASH}qcms`;
const macHome = `${SLASH}Users${SLASH}someone${SLASH}Projects`;
const drivePath = `C:${BACKSLASH}Users${BACKSLASH}someone${BACKSLASH}qcms`;
const uncPath = `${BACKSLASH}${BACKSLASH}wsl.localhost${BACKSLASH}Ubuntu`;

describe("pattern detection", () => {
  it("catches all four machine-specific shapes", () => {
    expect(pathsIn(posixHome).map((hit) => hit.kind)).toEqual(["posix home"]);
    expect(pathsIn(macHome).map((hit) => hit.kind)).toEqual(["macos home"]);
    expect(pathsIn(drivePath).map((hit) => hit.kind)).toEqual(["drive letter"]);
    expect(pathsIn(uncPath).map((hit) => hit.kind)).toEqual(["wsl unc"]);
  });

  it("captures the identifying part, and reports the whole reference", () => {
    // The capture is what an exemption names, which is what lets ALLOWED describe a
    // legitimate path without writing a resolvable one into the gate's source.
    const [hit] = pathsIn(posixHome);
    expect(hit?.match).toBe("dev");
    expect(hit?.text).toBe(`${SLASH}home${SLASH}dev`);
  });

  it("accepts the portable spellings the rule endorses", () => {
    // These are the fix, not the defect: a home directory named by a variable or shown
    // as a placeholder resolves on every machine.
    for (const portable of [
      `${SLASH}home${SLASH}<user>${SLASH}src`,
      `${SLASH}home${SLASH}\${HOME}`,
      `${SLASH}Users${SLASH}$USER${SLASH}src`,
      `${SLASH}Users${SLASH}%USERPROFILE%`,
      `~${SLASH}src${SLASH}qcms`,
    ]) {
      expect(pathsIn(portable)).toEqual([]);
    }
  });

  it("catches a drive path in its ESCAPED spelling, not only its raw one", () => {
    // The fail-open this gate shipped with (PR #791 review). A committed TS, JS or JSON
    // file does not carry a raw backslash: it carries the escaped one, and a nested
    // literal or a regular expression doubles it again. The gate was blind to exactly
    // the spelling the files most likely to hold a Windows path actually use.
    for (const depth of [1, 2, 3, 4]) {
      const separator = BACKSLASH.repeat(depth);
      const escaped = `const p = "C:${separator}Users${separator}dev";`;
      expect(
        pathsIn(escaped).map((hit) => hit.kind),
        `${String(depth)} backslash`,
      ).toEqual(["drive letter"]);
    }
    expect(pathsIn(`D:${SLASH}work${SLASH}qcms`).map((hit) => hit.kind)).toEqual(["drive letter"]);
  });

  it("does not read a URL scheme as a drive letter", () => {
    expect(pathsIn("https://example.com/a")).toEqual([]);
    expect(pathsIn("git://host/repo")).toEqual([]);
  });

  it("does not read a one-letter key before a regular expression as a drive letter", () => {
    // Why only the BACKSLASH run is doubled: a Windows path is never written with a
    // doubled forward slash, and accepting one would match these, which is how a gate
    // earns the false positive that gets it switched off.
    expect(pathsIn("const r = {a://x/.source};")).toEqual([]);
    expect(pathsIn("const v = c ? a :/re/.test(s);")).toEqual([]);
  });

  it("reports the line a path sits on", () => {
    expect(pathsIn(`clean\nclean\n${posixHome}`)[0]?.line).toBe(3);
  });
});

describe("exemption matching", () => {
  const anchor = ALLOWED[0];

  it("exempts the exact repo-relative path it names", () => {
    expect(anchor).toBeDefined();
    expect(exemption(anchor!.file, anchor!.kind, anchor!.match)).toBe(anchor!.why);
  });

  it("does not exempt a file that merely CONTAINS an allowlisted path", () => {
    // The check-ports review finding, pinned here too: with a substring test every one
    // of these is waved through and the run still reports no findings.
    for (const impostor of [
      `${anchor!.file}.bak`,
      `vendor/${anchor!.file}`,
      `third_party/mirror/${anchor!.file}`,
    ]) {
      expect(exemption(impostor, anchor!.kind, anchor!.match)).toBeUndefined();
    }
  });

  it("does not exempt a different path or a different shape in an allowlisted file", () => {
    expect(exemption(anchor!.file, anchor!.kind, `${anchor!.match}-other`)).toBeUndefined();
    expect(exemption(anchor!.file, "drive letter", anchor!.match)).toBeUndefined();
  });

  it("keeps every allowlist entry a plain repo-relative path with a reason", () => {
    for (const rule of ALLOWED) {
      expect(rule.file.startsWith("/")).toBe(false);
      expect(rule.file.startsWith("./")).toBe(false);
      expect(rule.why.length).toBeGreaterThan(0);
    }
  });

  it("has no dead entry: every exemption still fires", () => {
    // A dead exemption is not harmless - it reads as evidence the gate inspects that
    // file. If one goes dead because the file was reworded, delete it.
    for (const rule of ALLOWED) {
      const text = readFileSync(join(REPO_ROOT, rule.file), "utf8");
      const fired = pathsIn(text).some((hit) => hit.kind === rule.kind && hit.match === rule.match);
      expect(fired, `${rule.file} no longer contains the exempted ${rule.kind}`).toBe(true);
    }
  });
});

describe("scan scope", () => {
  it("reaches a non-trivial slice of the tree, and never fails open", () => {
    // `trackedFilesUnder` throws on an empty enumeration; this is the caller-side half
    // of the same rule, so a scope narrowed to nothing cannot report OK.
    const files = scanned();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("CONTRIBUTING.md");
  });

  it("excludes the scratch area and the vendored upstream copy", () => {
    const files = scanned();
    expect(files.some((file) => file.startsWith("plan/"))).toBe(false);
    expect(files.some((file) => file.startsWith("packages/ui/src/components/a2ui/"))).toBe(false);
  });

  it("still scans the QCMS-owned siblings of the vendored copy", () => {
    // Issue #775's other half: `packages/ui/src/components/` is not all vendored.
    expect(scanned()).toContain("packages/ui/src/components/submit/SubmitButton.tsx");
  });

  it("scans its own source, which is therefore free of machine paths", () => {
    // A gate that has to exempt itself has a hole exactly the shape of its own source.
    expect(scanned()).toContain("scripts/check-paths.mjs");
    expect(pathsIn(readFileSync(join(REPO_ROOT, "scripts/check-paths.mjs"), "utf8"))).toEqual([]);
    expect(pathsIn(readFileSync(join(REPO_ROOT, "scripts/check-paths.test.ts"), "utf8"))).toEqual(
      [],
    );
  });
});
