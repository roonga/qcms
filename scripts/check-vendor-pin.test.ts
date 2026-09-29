import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXEMPT,
  GLOBS,
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
 *
 * The last block drives the shipped script over a throwaway repository rather than
 * importing a helper, because the file set is a `git ls-files` pathspec list and a unit
 * test of {@link GLOBS} would only assert that the array contains the strings it
 * contains. What needs proving is that git resolves those pathspecs to the files, which
 * takes a git index (the same reason `check-changeset.test.ts` builds one).
 */

/** A version the lockfile does not resolve, in the fixtures below. */
const STALE = "1.6.26";
/** Stands in for the resolved pin. */
const PINNED = "1.7.1";

const GATE = fileURLToPath(new URL("check-vendor-pin.mjs", import.meta.url));

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
    expect(isExempt("pnpm-lock.yaml")).toBe(true);
  });

  it("does not let a file entry exempt a path that merely starts with it", () => {
    // The review finding. With a plain `startsWith` over the whole list, every one of
    // these is silently waved through and the gate still reports no findings, which is
    // the failure a gate exists to prevent. A backup, a generated copy or an
    // unrelated file sharing the prefix is not the record that earned the exemption.
    for (const impostor of [
      "docs/RETRO.md.bak",
      "docs/RETRO.md.orig",
      "docs/RETRO.mdx",
      "pnpm-lock.yaml.old",
      "docs/RETRO.md-notes.md",
    ]) {
      expect(isExempt(impostor)).toBe(false);
    }
  });

  it("does not let a file entry exempt a directory of the same name", () => {
    // `docs/RETRO.md/inner.md` cannot exist today, but the entry means one file and
    // should not quietly become a directory rule if the tree ever changes shape.
    expect(isExempt("docs/RETRO.md/inner.md")).toBe(false);
  });

  it("exempts a directory entry only at a path boundary", () => {
    // `plan/` covers what is under it, and nothing that merely shares the stem: a
    // sibling `plans/` or `plan-archive/` is ordinary tracked prose.
    expect(isExempt("plan/040-security-triage-input.md")).toBe(true);
    expect(isExempt("plans/040.md")).toBe(false);
    expect(isExempt("plan-archive/040.md")).toBe(false);
    expect(isExempt("docs/features-old/061.md")).toBe(false);
  });

  it("keeps docs/adr NOT exempt, so the decision record is scanned", () => {
    // PR #720 moved the decision record out of `docs/PROJECT_GOAL.md` and into
    // `docs/adr/`. That area is deliberately in scope: an exemption is a hole, and a
    // new one is earned by a real record failing the gate, not granted pre-emptively.
    expect(isExempt("docs/adr/core.md")).toBe(false);
    expect(isExempt("docs/adr/README.md")).toBe(false);
  });

  it("scans docs/PROJECT_GOAL.md, which is no longer exempt", () => {
    // The exemption existed because that file mixed append-only ADR history with live
    // decision text (#483 caveat 2). PR #720 took the history to `docs/adr/`, so what
    // is left is live text and the hole had nothing behind it (Code Owner, issue #725).
    expect(isExempt("docs/PROJECT_GOAL.md")).toBe(false);
    expect(EXEMPT).not.toContain("docs/PROJECT_GOAL.md");
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

  it("matches every exemption entry against itself, whichever kind it is", () => {
    // Guards the directory-vs-file split from the other side: an entry that matches
    // nothing at all is an exemption that looks present and does nothing, which is
    // how a record area silently rejoins the scan and starts failing the build.
    for (const entry of EXEMPT) {
      expect(isExempt(entry.endsWith("/") ? `${entry}some-record.md` : entry)).toBe(true);
    }
  });

  it("names the package families it tracks", () => {
    expect(TRACKED_PREFIXES).toContain("better-auth");
    expect(TRACKED_PREFIXES).toContain("@better-auth/");
  });
});

describe("the file set, driven end to end over a throwaway repository", () => {
  const repos: string[] = [];

  afterAll(() => {
    for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  });

  /** A lockfile resolving the stand-in pin, so the gate has something to compare to. */
  const LOCK = [
    "packages:",
    "",
    `  better-auth@${PINNED}:`,
    "    resolution: {integrity: sha512-abc}",
    "",
  ].join("\n");

  function write(root: string, filePath: string, content: string): void {
    const absolute = join(root, filePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  function run(root: string, args: string[]): void {
    // `as string`: every call site passes a literal argv whose first element is the
    // program name, so args[0] is never undefined; `noUncheckedIndexedAccess` cannot
    // see that. A runtime guard here would be unreachable code in a test helper.
    const result = spawnSync(args[0] as string, args.slice(1), { cwd: root, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${args.join(" ")} failed in ${root}: ${result.stderr}`);
    }
  }

  /**
   * A repository holding a lockfile and the given files, all tracked. The gate reads
   * `git ls-files`, so an untracked file is invisible to it and the fixture would pass
   * for the wrong reason.
   */
  function makeRepo(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "check-vendor-pin-"));
    repos.push(root);
    run(root, ["git", "init", "-q", "-b", "main"]);
    write(root, "pnpm-lock.yaml", LOCK);
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    run(root, ["git", "add", "-A"]);
    return root;
  }

  function runGate(root: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [GATE], { cwd: root, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  /** The comment shape `docker/api.Dockerfile` actually carries, at a given version. */
  const dockerComment = (version: string): string =>
    ["FROM node:24-alpine", `# better-auth@${version} declares optional peers on kysely`, ""].join(
      "\n",
    );

  it("FAILS on a stale version in a Dockerfile", () => {
    // The regression PR #1007's review found by hand: `docker/api.Dockerfile` named a
    // version three bumps behind and no carry had ever seen the file.
    const root = makeRepo({ "docker/api.Dockerfile": dockerComment(STALE) });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docker/api.Dockerfile:2");
    expect(result.stderr).toContain(STALE);
  });

  it("FAILS on a stale version in a `.tmpl` file", () => {
    // The generated half of the same sentence. A template is a copy of a file that is
    // scanned, so leaving it out made the gate's coverage depend on which copy drifted.
    const root = makeRepo({
      "packages/create-qcms-app/templates/common/docker/api.Dockerfile.tmpl": dockerComment(STALE),
    });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "packages/create-qcms-app/templates/common/docker/api.Dockerfile.tmpl:2",
    );
  });

  it("FAILS on a Dockerfile written in any of the spellings, not only `*.Dockerfile`", () => {
    // A bare `Dockerfile` is a literal pathspec and reaches only the repository root,
    // so the nested spelling is listed beside it; without it a Dockerfile added outside
    // `docker/` would be invisible and the run would print OK.
    const root = makeRepo({
      Dockerfile: dockerComment(STALE),
      "apps/api/Dockerfile": dockerComment(STALE),
      "Dockerfile.dev": dockerComment(STALE),
      "docker/local/Dockerfile.seed": dockerComment(STALE),
    });

    const result = runGate(root);

    expect(result.status).toBe(1);
    for (const file of [
      "Dockerfile:2",
      "apps/api/Dockerfile:2",
      "Dockerfile.dev:2",
      "docker/local/Dockerfile.seed:2",
    ]) {
      expect(result.stderr).toContain(file);
    }
  });

  it("passes when a Dockerfile and a template name the resolved version", () => {
    // The other side of the first two cases: proves they fail on the version rather
    // than on the file merely being readable.
    const root = makeRepo({
      "docker/api.Dockerfile": dockerComment(PINNED),
      "packages/create-qcms-app/templates/common/docker/api.Dockerfile.tmpl": dockerComment(PINNED),
    });

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("does NOT scan a `.sql` migration naming an older version", () => {
    // Deliberate, not an oversight (Code Owner, 2026-09-29): a released migration is an
    // append-only record of the release whose behaviour it describes, and forcing its
    // number forward would make a true sentence false. The gate reads no `.sql` at all,
    // so the run is green with this file in the tree.
    const root = makeRepo({
      "packages/db/migrations/0020_account_drops_issuer.sql": [
        `-- better-auth ${STALE} reverses the account identity change its predecessors required.`,
        'ALTER TABLE "account" DROP COLUMN "issuer";',
        "",
      ].join("\n"),
    });

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK");
    expect(GLOBS).not.toContain("*.sql");
  });

  it("still reads the prose and source extensions it started with", () => {
    // A guard against a future edit to GLOBS dropping one while adding another: the
    // original set is what the gate was built for.
    for (const glob of ["*.md", "*.ts", "*.yml", "*.sh", "*.example"]) {
      expect(GLOBS).toContain(glob);
    }
    const root = makeRepo({ "docs/SECURITY_DESIGN.md": `better-auth ${STALE} resolves this.\n` });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/SECURITY_DESIGN.md:1");
  });
});
