import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { WORKSPACE_ROOT, eslintBin, rewriteArgs } from "./eslint-workspace.mjs";

/**
 * `eslint-plugin-sonarjs` rules need a test framework declared at or above the linted file, searched
 * up to `context.cwd`. The frameworks are declared in the root manifest only, so the cwd decides.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(REPO_ROOT, "scripts", "eslint-workspace.mjs");

/**
 * A spawning case is bounded by host scheduling rather than by its own work, so the
 * budget is an order of magnitude over the worst measurement on a loaded machine.
 */
const SPAWN_TIMEOUT_MS = 300_000;

const fixtureRoots: string[] = [];

/**
 * Must live under the repository root, not a temp directory: the root flat config has to
 * reach the file, and the nearest `package.json` above it has to be the root one. The
 * spec reaches the framework indirectly, or the rule would fire from any directory.
 */
function writeFixture(): string {
  const root = mkdtempSync(path.join(REPO_ROOT, ".lint-cwd-fixture-"));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, "support"));
  writeFileSync(
    path.join(root, "support", "gates.mjs"),
    [
      "export const test = () => {};",
      "export const expect = () => ({ toBeChecked: () => {} });",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "forced-interaction.pw.mjs"),
    [
      'import { expect, test } from "./support/gates.mjs";',
      "",
      'test("a discrete choice has no clear path", async ({ page }) => {',
      '  const no = page.getByRole("radio", { name: "No", exact: true });',
      "  await no.click({ force: true });",
      "  await expect(no).toBeChecked();",
      "});",
      "",
    ].join("\n"),
  );
  return root;
}

function lint(
  cwd: string,
  args: string[],
  { viaRunner }: { viaRunner: boolean },
): { stdout: string; status: number | null } {
  const entry = viaRunner ? RUNNER : eslintBin();
  const result = spawnSync(process.execPath, [entry, "-f", "json", ...args], {
    cwd,
    encoding: "utf8",
  });
  return { stdout: result.stdout, status: result.status };
}

interface LintMessage {
  readonly ruleId: string | null;
  readonly line: number;
}

function ruleIds(stdout: string): (string | null)[] {
  const report = JSON.parse(stdout) as { messages: LintMessage[] }[];
  return report.flatMap((file) => file.messages.map((message) => message.ruleId));
}

afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

describe("moving lint targets to the workspace root", () => {
  it("resolves a package's own directory to its path under the root", () => {
    expect(rewriteArgs(["."], path.join(WORKSPACE_ROOT, "apps/portal"))).toEqual(["apps/portal"]);
  });

  it("resolves several targets, globs included", () => {
    expect(
      rewriteArgs(["src", "e2e", "src/**/*.ts"], path.join(WORKSPACE_ROOT, "apps/api")),
    ).toEqual(["apps/api/src", "apps/api/e2e", "apps/api/src/**/*.ts"]);
  });

  it("leaves the root's own targets alone", () => {
    expect(rewriteArgs(["scripts", "eslint.config.js"], WORKSPACE_ROOT)).toEqual([
      "scripts",
      "eslint.config.js",
    ]);
  });

  it("passes flags and their values through untouched", () => {
    expect(rewriteArgs(["-f", "json", "."], path.join(WORKSPACE_ROOT, "apps/portal"))).toEqual([
      "-f",
      "json",
      "apps/portal",
    ]);
    expect(
      rewriteArgs(["--max-warnings=0", "."], path.join(WORKSPACE_ROOT, "apps/portal")),
    ).toEqual(["--max-warnings=0", "apps/portal"]);
  });

  it("leaves an absolute target alone", () => {
    const absolute = path.join(WORKSPACE_ROOT, "apps/portal/e2e");
    expect(rewriteArgs([absolute], path.join(WORKSPACE_ROOT, "apps/api"))).toEqual([absolute]);
  });
});

describe("one verdict per file, whatever the working directory", () => {
  it(
    "reports the same bytes from the fixture directory as from the repository root",
    () => {
      const fixture = writeFixture();
      const spec = path.join(fixture, "forced-interaction.pw.mjs");

      const fromRoot = lint(WORKSPACE_ROOT, [path.relative(WORKSPACE_ROOT, spec)], {
        viaRunner: false,
      });
      const fromFixture = lint(fixture, ["forced-interaction.pw.mjs"], { viaRunner: true });

      expect(ruleIds(fromRoot.stdout)).toEqual(["sonarjs/no-forced-browser-interaction"]);
      expect(fromRoot.status).toBe(1);

      expect(fromFixture.stdout).toEqual(fromRoot.stdout);
      expect(fromFixture.status).toBe(fromRoot.status);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "still reports it when the package directory declares no test framework",
    () => {
      const fixture = writeFixture();
      writeFileSync(
        path.join(fixture, "package.json"),
        `${JSON.stringify({ name: "lint-cwd-fixture", private: true }, null, 2)}\n`,
      );

      const fromFixture = lint(fixture, ["forced-interaction.pw.mjs"], { viaRunner: true });
      expect(ruleIds(fromFixture.stdout)).toEqual(["sonarjs/no-forced-browser-interaction"]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
