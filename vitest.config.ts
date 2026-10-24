import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * A percentage so it scales on a small CI runner. Vitest 5.0.4 made `maxWorkers`
 * per-project, and two projects in one scheduling group with different budgets is a
 * hard refusal, so every project entry below has to carry this same value.
 */
const MAX_WORKERS = "25%";

/**
 * `fsModuleCache` is off because the cache is one directory shared by every Vitest
 * process in the checkout and invalidating it is an `rm -rf`, so the ten concurrent
 * processes `pnpm test` starts race to an `ENOTEMPTY` startup error. A per-project
 * `fsModuleCachePath` does not help: the clear always includes the shared root.
 */
const PROJECT_DEFAULTS = { maxWorkers: MAX_WORKERS, fsModuleCache: false } as const;

/**
 * Replaces a `"packages/*"` glob, which cannot carry {@link PROJECT_DEFAULTS}: a
 * globbed directory's project is built from what that directory declares, and
 * `extends` inside the directory's own config does not carry `maxWorkers` either.
 * `name` is passed in both shapes because an entry that does not name itself is
 * named by its index, and every `--project <name>` caller depends on the name.
 */
function workspaceProjects(parent: string): object[] {
  const parentDirectory = fileURLToPath(new URL(parent, import.meta.url));
  return readdirSync(parentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parentDirectory}/${entry.name}`)
    .filter((root) => existsSync(`${root}/package.json`))
    .map((root) => {
      const manifest: unknown = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
      const name = String((manifest as { readonly name?: unknown }).name);
      const own = `${root}/vitest.config.ts`;
      return existsSync(own)
        ? { extends: own, test: { name, root, ...PROJECT_DEFAULTS } }
        : { extends: true, test: { name, root, ...PROJECT_DEFAULTS } };
    });
}

// An inline project's `root` resolves against the process cwd, and turbo runs
// `pnpm test` from inside apps/api, so these are resolved from this file instead.
const API_ROOT = fileURLToPath(new URL("apps/api", import.meta.url));

const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));

const CREATE_APP_ROOT = fileURLToPath(new URL("packages/create-qcms-app", import.meta.url));

// `scripts/check-coverage-measured.mjs` resolves this same directory from its own
// location; the two have to agree.
const COVERAGE_DIR = fileURLToPath(new URL("coverage", import.meta.url));

export default defineConfig({
  test: {
    ...PROJECT_DEFAULTS,
    projects: [
      ...workspaceProjects("packages"),
      ...workspaceProjects("apps"),
      // Listed explicitly because `workspaceProjects` takes one config per directory,
      // so a sibling config file is invisible to it.
      {
        extends: "apps/admin/vitest.dom.config.ts",
        test: {
          name: "qcms-admin-dom",
          root: fileURLToPath(new URL("apps/admin", import.meta.url)),
          ...PROJECT_DEFAULTS,
        },
      },
      // A project of its own so `*.e2e.ts` is not double-run by the `apps/*` project,
      // which globs `*.test.ts`.
      {
        extends: true,
        test: {
          name: "qcms-api-e2e",
          root: API_ROOT,
          include: ["e2e/**/*.e2e.ts"],
          // Only container boot stretches with how many containers the machine is
          // starting at once, so the hook budget is the larger one and matches
          // `CONTAINER_BOOT_TIMEOUT_MS` in `@roonga/qcms-db/testing`.
          testTimeout: 120_000,
          hookTimeout: 240_000,
        },
      },
      // Needs the Compose stack `pnpm qcms:scaffold-e2e` stands up, so it stays out of
      // `pnpm test`.
      {
        extends: true,
        test: {
          name: "create-qcms-app-e2e",
          root: CREATE_APP_ROOT,
          include: ["e2e/**/*.e2e.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      // Run but deliberately neither typechecked nor linted: ESLint's project service
      // does not reach files outside packages/ and apps/, and typechecking these would
      // need a root tsconfig.
      {
        extends: true,
        test: {
          name: "tooling",
          root: REPO_ROOT,
          include: ["scripts/**/*.test.ts", ".devcontainer/**/*.test.ts"],
        },
      },
    ],
    // `include` matches relative to the PROJECT root in Vitest 5, so `src/**` and not
    // `packages/core/src/**`: the repo-relative spelling matched nothing and still
    // exited 0 against the threshold. `packages/core`'s `coverage` script chains
    // `scripts/check-coverage-measured.mjs` because Vitest cannot fail an empty report.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // `json-summary` is what `scripts/check-coverage-measured.mjs` reads.
      reporter: ["text", "json-summary"],
      // Pinned to this file's directory so the guard cannot read a report another run
      // left behind.
      reportsDirectory: COVERAGE_DIR,
      thresholds: {
        lines: 95,
      },
    },
  },
});
