import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { resolveTarget } from "./clean-dist.mjs";

/**
 * Tests for the pre-build clean step (issue #494).
 *
 * The bug is a stale emitted file surviving a rebuild, so the test that matters plants
 * one and rebuilds. The guard tests are here because this script's whole job is a
 * recursive delete: a false ACCEPT is the expensive direction, so each refusal is
 * pinned rather than assumed.
 */

const SCRIPT = fileURLToPath(new URL("clean-dist.mjs", import.meta.url));

const tempDirs: string[] = [];

function packageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clean-dist-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "stub" }), "utf8");
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("removing the build output", () => {
  it("removes a dist directory left by an earlier configuration", () => {
    // The #494 shape: `tsc` overwrites but never deletes, so a file a previous build
    // emitted keeps resolving and keeps type-checking long after its source is gone.
    const dir = packageDir();
    mkdirSync(join(dir, "dist", "nested"), { recursive: true });
    writeFileSync(join(dir, "dist", "withdrawn-export.js"), "export const stale = 1;\n", "utf8");
    writeFileSync(join(dir, "dist", "nested", "deep.d.ts"), "export declare const x: 1;\n", "utf8");

    execFileSync(process.execPath, [SCRIPT], { cwd: dir });

    expect(existsSync(join(dir, "dist"))).toBe(false);
    // The source beside it is untouched: this removes build output, nothing else.
    expect(existsSync(join(dir, "package.json"))).toBe(true);
  });

  it("succeeds on a first build, where there is nothing to remove", () => {
    const dir = packageDir();
    expect(() => execFileSync(process.execPath, [SCRIPT], { cwd: dir })).not.toThrow();
  });
});

describe("refusing anything that is not a package's own build output", () => {
  it("refuses a directory with no package.json beside it", () => {
    // Without this, a script invoked from the wrong cwd deletes a `dist` that belongs
    // to nobody, and a recursive delete is the one operation that must fail closed.
    const dir = mkdtempSync(join(tmpdir(), "clean-dist-bare-"));
    tempDirs.push(dir);
    expect(resolveTarget(dir, "dist")).toEqual({
      ok: false,
      reason: `refusing to run in ${dir}: no package.json, so this is not a package root`,
    });
  });

  it("refuses an absolute path, a traversal, and an empty name", () => {
    const dir = packageDir();
    for (const target of ["/", "/usr", "../dist", "a/../../b", ""]) {
      expect(resolveTarget(dir, target).ok, `accepted ${JSON.stringify(target)}`).toBe(false);
    }
  });

  it("accepts a plain nested output name", () => {
    // `dist` is the only name in use today; the argument exists so a package with a
    // different output directory does not need a second script.
    const dir = packageDir();
    expect(resolveTarget(dir, "build/out")).toEqual({ ok: true, path: join(dir, "build", "out") });
  });
});
