import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  findPublishablePackages,
  isExemptPath,
  parseChangesetPackages,
  parseWorkspaceGlobs,
} from "./check-changeset.mjs";

const GATE = fileURLToPath(new URL("check-changeset.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const repos: string[] = [];

afterAll(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

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

function commit(root: string, message: string): void {
  run(root, ["git", "add", "-A"]);
  run(root, [
    "git",
    "-c",
    "user.email=gate@example.test",
    "-c",
    "user.name=Gate Test",
    "commit",
    "-q",
    "-m",
    message,
  ]);
}

/**
 * A throwaway repo shaped like this one: two publishable packages, one private
 * app, a changesets config. Committed on `main`, then switched to a work branch
 * so the gate has something to diff. The gate is run against THIS repo's script
 * file with the fixture as cwd, so the code under test is the shipped one.
 */
function makeRepo(options: { seedChangeset?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "check-changeset-"));
  repos.push(root);

  run(root, ["git", "init", "-q", "-b", "main"]);
  write(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "apps/*"\n');
  write(root, ".changeset/config.json", JSON.stringify({ ignore: ["qcms-api"] }));
  write(root, "packages/core/package.json", JSON.stringify({ name: "@qcms/core" }));
  write(root, "packages/db/package.json", JSON.stringify({ name: "@qcms/db" }));
  write(
    root,
    "packages/private-tool/package.json",
    JSON.stringify({ name: "tool", private: true }),
  );
  write(root, "apps/api/package.json", JSON.stringify({ name: "qcms-api", private: true }));
  write(root, "packages/core/src/index.ts", "export const version = 1;\n");
  if (options.seedChangeset !== undefined) {
    write(root, ".changeset/seeded.md", options.seedChangeset);
  }
  commit(root, "base");
  run(root, ["git", "checkout", "-q", "-b", "work"]);
  return root;
}

function runGate(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [GATE], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DEFAULT_BRANCH: "main" },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const CORE_CHANGESET = '---\n"@qcms/core": patch\n---\n\nA change.\n';

describe("check-changeset gate", () => {
  it("FAILS when a publishable package changes with no changeset", () => {
    const root = makeRepo();
    write(root, "packages/core/src/index.ts", "export const version = 2;\n");
    commit(root, "change core");

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@qcms/core");
    expect(result.stderr).toContain("packages/core/src/index.ts");
  });

  it("passes when the same change carries a changeset naming the package", () => {
    const root = makeRepo();
    write(root, "packages/core/src/index.ts", "export const version = 2;\n");
    write(root, ".changeset/lucky-pandas-sing.md", CORE_CHANGESET);
    commit(root, "change core with changeset");

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@qcms/core");
  });

  it("is not satisfied by a changeset naming a different package", () => {
    const root = makeRepo();
    write(root, "packages/core/src/index.ts", "export const version = 2;\n");
    write(root, ".changeset/wrong-package.md", '---\n"@qcms/db": patch\n---\n\nElsewhere.\n');
    commit(root, "change core, changeset for db");

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@qcms/core");
  });

  it("is not satisfied by a changeset that was already on the default branch", () => {
    const root = makeRepo({ seedChangeset: CORE_CHANGESET });
    write(root, "packages/core/src/index.ts", "export const version = 2;\n");
    commit(root, "change core, riding an unreleased changeset");

    const result = runGate(root);

    expect(result.status).toBe(1);
  });

  it("passes a docs-only diff, including a package README", () => {
    const root = makeRepo();
    write(root, "docs/notes.md", "# notes\n");
    write(root, "packages/core/README.md", "# core\n");
    write(root, "packages/core/CHANGELOG.md", "# changelog\n");
    commit(root, "docs only");

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no publishable package changed");
  });

  it("passes an app-only diff", () => {
    const root = makeRepo();
    write(root, "apps/api/src/route.ts", "export const route = 1;\n");
    write(root, "packages/private-tool/src/main.ts", "export const tool = 1;\n");
    commit(root, "app only");

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no publishable package changed");
  });

  it("passes a test-only diff inside a publishable package", () => {
    const root = makeRepo();
    write(root, "packages/core/src/index.test.ts", "// colocated test\n");
    write(root, "packages/db/e2e/flow.e2e.ts", "// suite file\n");
    write(root, "packages/db/__tests__/helper.ts", "// test helper\n");
    commit(root, "tests only");

    const result = runGate(root);

    expect(result.status).toBe(0);
  });

  it("still requires a changeset for the exported testing subpath", () => {
    const root = makeRepo();
    write(root, "packages/db/src/testing/with-test-db.ts", "export const harness = 1;\n");
    commit(root, "change the exported testing surface");

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@qcms/db");
  });

  it("passes a `changeset version` release diff, which consumes changesets", () => {
    const root = makeRepo({ seedChangeset: CORE_CHANGESET });
    rmSync(join(root, ".changeset/seeded.md"));
    write(root, "packages/core/package.json", JSON.stringify({ name: "@qcms/core", version: "2" }));
    write(root, "packages/core/CHANGELOG.md", "# @qcms/core\n\n## 2\n");
    commit(root, "release");

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("release diff");
  });

  it("FAILS LOUDLY on a workspace glob it cannot expand", () => {
    // The throw is deliberate: silently skipping an unexpanded glob would leave
    // the packages it covers unguarded, which is the failure mode this gate exists
    // to prevent.
    const root = makeRepo();
    write(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/**/nested"\n');
    commit(root, "unsupported workspace glob");

    const result = runGate(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsupported workspace glob");
  });

  it("passes silently on the default branch (empty diff)", () => {
    const root = makeRepo();
    run(root, ["git", "checkout", "-q", "main"]);

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("fails when a source file is deleted from a publishable package", () => {
    const root = makeRepo();
    rmSync(join(root, "packages/core/src/index.ts"));
    commit(root, "delete core source");

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@qcms/core");
  });
});

describe("check-changeset helpers", () => {
  it("derives the publishable set of THIS repo from the private field", () => {
    expect(findPublishablePackages(REPO_ROOT).map((pkg) => pkg.name)).toEqual([
      "@qcms/a2ui-compiler",
      "@qcms/core",
      // `@qcms/csv` and `@qcms/observability` were private helpers until task 037
      // needed them installable: all three scaffolded apps depend on them at runtime,
      // and a scaffolded project has no workspace to resolve `workspace:*` against.
      "@qcms/csv",
      "@qcms/db",
      "@qcms/observability",
      "@qcms/ui",
      // The scaffolding CLI (task 037) is unscoped, and publishable for the same
      // reason the packages are: an adopter runs `pnpm create qcms-app`, so a change
      // to it is a change a consumer can see and needs a changeset.
      "create-qcms-app",
    ]);
  });

  it("reads the workspace globs", () => {
    expect(parseWorkspaceGlobs('packages:\n  - "packages/*"\n  - "apps/*"\n')).toEqual([
      "packages/*",
      "apps/*",
    ]);
  });

  it("reads package names out of changeset frontmatter", () => {
    expect(
      parseChangesetPackages('---\n"@qcms/core": minor\n"@qcms/ui": patch\n---\n\nBody: patch\n'),
    ).toEqual(["@qcms/core", "@qcms/ui"]);
    expect(parseChangesetPackages("no frontmatter here\n")).toEqual([]);
  });

  it("exempts docs and tests but not source or the testing subpath", () => {
    expect(isExemptPath("packages/core/README.md")).toBe(true);
    expect(isExemptPath("packages/core/src/rules.test.ts")).toBe(true);
    expect(isExemptPath("packages/ui/src/__tests__/render.tsx")).toBe(true);
    expect(isExemptPath("packages/core/src/rules.ts")).toBe(false);
    expect(isExemptPath("packages/db/src/testing/index.ts")).toBe(false);
    expect(isExemptPath("packages/core/package.json")).toBe(false);
  });
});
