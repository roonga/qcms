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
 * Every fixture interpolates its version rather than writing one inline, so this file
 * scans clean under the gate it tests.
 */

const STALE = "1.6.26";
const PINNED = "1.7.1";
const PEER = "0.4.2";
const PEER_NEXT = "0.5.0";

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
    expect(assertionsIn(`better-auth ${PINNED}1`)).toEqual([
      { pkg: "better-auth", version: `${PINNED}1`, line: 1 },
    ]);
  });

  it("does not match a four-part version, which is not a version this lockfile writes", () => {
    expect(assertionsIn(`better-auth ${PINNED}.4`)).toEqual([]);
  });

  it("does not match a source citation that carries no version", () => {
    expect(assertionsIn("`@better-auth/core/dist/types/init-options.d.mts:430,441`")).toEqual([]);
    expect(assertionsIn("better-auth resolves `enabled` at `dist/api/index.mjs:162-168`")).toEqual(
      [],
    );
  });

  it("does not match a package.json dependency range", () => {
    expect(assertionsIn(`"better-auth": "^${PINNED}"`)).toEqual([]);
  });
});

describe("lockfile resolution", () => {
  // The three spellings pnpm writes: unquoted bare, quoted scoped, and a `snapshots:`
  // key carrying a peer-dependency suffix.
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
    `  '@better-auth/core@${PINNED}(@better-auth/utils@${PEER})':`,
    "    dependencies:",
    `      '@better-auth/utils': ${PEER}`,
  ].join("\n");

  it("reads the resolved version of each better-auth package", () => {
    const resolved = resolvedVersions(lock);
    expect([...(resolved.get("better-auth") ?? [])]).toEqual([PINNED]);
    expect([...(resolved.get("@better-auth/core") ?? [])]).toEqual([PINNED]);
  });

  it("ignores a nested dependency line, which is indented past a top-level key", () => {
    expect(resolvedVersions(lock).has("@better-auth/utils")).toBe(false);
  });

  it("collects every resolution when a package appears at two versions", () => {
    const twice = [
      "packages:",
      "",
      `  '@better-auth/utils@${PEER}':`,
      `  '@better-auth/utils@${PEER_NEXT}':`,
    ].join("\n");
    expect([...(resolvedVersions(twice).get("@better-auth/utils") ?? [])].sort()).toEqual([
      PEER,
      PEER_NEXT,
    ]);
  });

  it("returns nothing for a lockfile with no better-auth in it", () => {
    // `main()` reads an empty map as the lockfile format having moved, and fails loudly.
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
    // This path cannot exist today; the file entry must still never become a directory rule.
    expect(isExempt("docs/RETRO.md/inner.md")).toBe(false);
  });

  it("exempts a directory entry only at a path boundary", () => {
    expect(isExempt("plan/040-security-triage-input.md")).toBe(true);
    expect(isExempt("plans/040.md")).toBe(false);
    expect(isExempt("plan-archive/040.md")).toBe(false);
    expect(isExempt("docs/features-old/061.md")).toBe(false);
  });

  it("keeps docs/adr NOT exempt, so the decision record is scanned", () => {
    expect(isExempt("docs/adr/core.md")).toBe(false);
    expect(isExempt("docs/adr/README.md")).toBe(false);
  });

  it("scans docs/PROJECT_GOAL.md, which is no longer exempt", () => {
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
    for (const entry of EXEMPT) {
      expect(entry.startsWith("/")).toBe(false);
      expect(entry.startsWith("./")).toBe(false);
    }
  });

  it("matches every exemption entry against itself, whichever kind it is", () => {
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
    // `as string`: every call site passes a literal argv, so args[0] is never undefined.
    const result = spawnSync(args[0] as string, args.slice(1), { cwd: root, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${args.join(" ")} failed in ${root}: ${result.stderr}`);
    }
  }

  /** Files must be tracked: the gate reads `git ls-files`, so an untracked file is invisible. */
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

  const dockerComment = (version: string): string =>
    ["FROM node:24-alpine", `# better-auth@${version} declares optional peers on kysely`, ""].join(
      "\n",
    );

  it("FAILS on a stale version in a Dockerfile", () => {
    const root = makeRepo({ "docker/api.Dockerfile": dockerComment(STALE) });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docker/api.Dockerfile:2");
    expect(result.stderr).toContain(STALE);
  });

  it("FAILS on a stale version in a `.tmpl` file", () => {
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
    // A bare `Dockerfile` is a literal pathspec reaching only the repository root, so
    // GLOBS lists the nested spelling beside it.
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
    const root = makeRepo({
      "docker/api.Dockerfile": dockerComment(PINNED),
      "packages/create-qcms-app/templates/common/docker/api.Dockerfile.tmpl": dockerComment(PINNED),
    });

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("does NOT scan a `.sql` migration naming an older version", () => {
    // Deliberate: a released migration records the release it describes, so forcing its
    // version forward would make a true sentence false.
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
    for (const glob of ["*.md", "*.ts", "*.yml", "*.sh", "*.example"]) {
      expect(GLOBS).toContain(glob);
    }
    const root = makeRepo({ "docs/SECURITY_DESIGN.md": `better-auth ${STALE} resolves this.\n` });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/SECURITY_DESIGN.md:1");
  });
});
