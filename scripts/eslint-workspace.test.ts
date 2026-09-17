import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { WORKSPACE_ROOT, eslintBin, rewriteArgs } from "./eslint-workspace.mjs";

/**
 * Tests for the one-working-directory lint runner (issue #899).
 *
 * The defect this guards: `apps/portal/e2e/clear-paths.pw.ts` reported two
 * `sonarjs/no-forced-browser-interaction` errors when ESLint ran from the repository
 * root and zero when it ran from `apps/portal`, which is how `turbo run lint` invokes
 * it. The file was linted both times, under the same config; only the verdict differed.
 * Fourteen `eslint-plugin-sonarjs` rules activate only when a test framework is
 * declared in a `package.json` at or above the linted file, and that upward search
 * stops at `context.cwd`. QCMS declares `vitest` and `@playwright/test` in the root
 * manifest only, so from a package directory the search found neither and all fourteen
 * rules returned an empty visitor.
 *
 * So the central test lints ONE file twice and demands the same bytes back. It is
 * written against a fixture rather than against the real spec because the real spec now
 * carries two justified `eslint-disable-next-line` comments: it reports nothing from
 * either directory, which is the same answer a rule that never ran gives.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(REPO_ROOT, "scripts", "eslint-workspace.mjs");

/**
 * Per-case budget for the cases that spawn ESLint. One cold ESLint run over this config
 * loads 279 sonarjs rules plus typescript-eslint, and the central case pays for two of
 * them, so the 5s default is not the right bound.
 *
 * The number is measured at both ends rather than guessed (issue #604). Idle, the two
 * cases take 4.6s and 2.0s. On the same 24-core host at load average 122, with several
 * other gate runs competing, they take 30.4s and 16.8s: a spawning test is bounded by
 * scheduling, not by its own work, so the honest budget is one that survives a busy
 * machine. 300s leaves roughly an order of magnitude over the worst measurement and
 * still fails fast against a genuine hang.
 */
const SPAWN_TIMEOUT_MS = 300_000;

const fixtureRoots: string[] = [];

/**
 * A fixture tree shaped like `apps/portal/e2e/clear-paths.pw.ts`: a Playwright spec
 * that reaches the framework through a relative support module rather than importing
 * `@playwright/test` itself, and forces a click on the radio input react-aria keeps
 * visually hidden behind its label.
 *
 * The indirection is the whole point. A file that imports `@playwright/test` by name
 * activates the rule from any directory, so it could not show the divergence; the real
 * specs import `./support/gates.js`, and the manifest walk is the only signal left.
 *
 * It lives under the repository root, not in a system temp directory, for two reasons
 * the mechanism forces: the root flat config has to reach the file, and the nearest
 * `package.json` above it has to be the root one that declares `@playwright/test`.
 *
 * @returns the absolute fixture directory, registered for cleanup.
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

/**
 * ESLint, as JSON, run from `cwd`.
 *
 * @param cwd the working directory to run from.
 * @param args the ESLint arguments, written relative to `cwd`.
 * @param viaRunner true to go through `scripts/eslint-workspace.mjs`.
 */
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

/** @returns every rule id reported over every file in an ESLint JSON report. */
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
    // `json` must not become `apps/portal/json`: a flag value read as a target is the
    // near-miss that would make the runner lint the wrong tree.
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

      // Non-vacuous first: if the rule stopped firing at the root, identical output would
      // mean nothing, because "clean" and "never ran" are the same report.
      expect(ruleIds(fromRoot.stdout)).toEqual(["sonarjs/no-forced-browser-interaction"]);
      expect(fromRoot.status).toBe(1);

      // The assertion the issue asks for: same file, same config, two directories, one
      // answer, down to the JSON.
      expect(fromFixture.stdout).toEqual(fromRoot.stdout);
      expect(fromFixture.status).toBe(fromRoot.status);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "still reports it when the package directory declares no test framework",
    () => {
      // The shape of `apps/portal`: a manifest that stops the upward search one directory
      // below the root one, which is what silenced the rule before this fix. A bare
      // `eslint` here returned an empty report; the runner must not.
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
