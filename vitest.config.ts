import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// An absolute path to apps/api, resolved from this config file (not the process
// cwd). An inline project's `root` is resolved relative to the CWD, so a bare
// "apps/api" breaks when Vitest runs from inside apps/api (turbo's `pnpm test`,
// cwd = apps/api) — it would look for apps/api/apps/api and find nothing.
const API_ROOT = fileURLToPath(new URL("apps/api", import.meta.url));

// Single root Vitest configuration - every package and app is a project here;
// no per-package runners or configs. (Vitest 4 removed vitest.workspace.ts;
// test.projects is its replacement - task 001.)
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      // The 027 consumer-level e2e suite: a dedicated project so CI can run it
      // as its own job (signal clarity) and its Docker-heavy files can be
      // parallelised independently. Scenario files are named `*.e2e.ts` so the
      // default `apps/*` (qcms-api) project — which globs `*.test.ts` — never
      // double-runs them. Kept inside `pnpm test` via apps/api's test script.
      {
        extends: true,
        test: {
          name: "qcms-api-e2e",
          root: API_ROOT,
          include: ["e2e/**/*.e2e.ts"],
          // Each scenario file boots its own Testcontainers Postgres; give the
          // suite room for image pull + boot on a cold CI runner.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    // Coverage is a root-level concern in Vitest 4 (projects cannot carry
    // their own). Scope: the kernel (task 009 exit criterion 4 - lines
    // >= 95% across tasks 002-009, `pnpm --filter @qcms/core coverage`).
    // Test files are excluded by Vitest's defaults.
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**"],
      thresholds: {
        lines: 95,
      },
    },
  },
});
