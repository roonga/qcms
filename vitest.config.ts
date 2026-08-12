import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// An absolute path to apps/api, resolved from this config file (not the process
// cwd). An inline project's `root` is resolved relative to the CWD, so a bare
// "apps/api" breaks when Vitest runs from inside apps/api (turbo's `pnpm test`,
// cwd = apps/api) - it would look for apps/api/apps/api and find nothing.
const API_ROOT = fileURLToPath(new URL("apps/api", import.meta.url));

// Repo root, resolved from this file for the same reason API_ROOT is.
const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));

// The scaffolding CLI's root, resolved the same way API_ROOT is.
const CREATE_APP_ROOT = fileURLToPath(new URL("packages/create-qcms-app", import.meta.url));

// Single root Vitest configuration - every package and app is a project here;
// no per-package runners or configs. (Vitest 4 removed vitest.workspace.ts;
// test.projects is its replacement - task 001.)
export default defineConfig({
  test: {
    // Bound the per-run worker pool. Every package's `test` script runs
    // `vitest run --root <repo> --project <name>`, so each turbo task spawns its
    // own pool against this config and turbo runs several of those at once: the
    // two multiply. Measured on a 24-core box, `turbo run test --force` went from
    // a peak of 32 concurrent worker processes to 16 with this plus the paired
    // `concurrency` in turbo.json, for about 9% more wall time (66s to 72s).
    //
    // What this does and does not buy, measured rather than assumed: it lowers
    // oversubscription and the process/memory footprint, so a long agent-loop
    // session stops starving everything else sharing the machine. It does NOT
    // lower peak CPU (peak load was 23.3 uncapped and 24.6 capped) - the suite is
    // CPU-bound, so it will use whatever cores it is given. A hard CPU ceiling
    // belongs to the host (WSL2 `.wslconfig` `processors`, or a container
    // `--cpus` limit), deliberately not committed here because a fixed core count
    // would throttle a contributor with fewer cores.
    //
    // Percentages, not fixed numbers, so both scale down on a 2-to-4-core CI
    // runner instead of oversubscribing it.
    maxWorkers: "25%",
    projects: [
      "packages/*",
      "apps/*",
      // The admin's second project (issue #352): `.tsx` tests under jsdom with
      // testing-library, so a component can be rendered and driven rather than only
      // stringified. Named explicitly because the `apps/*` glob above resolves one
      // default-named config per directory, so a sibling config file is invisible to it.
      // Both admin projects live in `apps/admin/` and share their `@/` alias; the split
      // between them is by file extension and is documented in each.
      "apps/admin/vitest.dom.config.ts",
      // The 027 consumer-level e2e suite: a dedicated project so CI can run it
      // as its own job (signal clarity) and its Docker-heavy files can be
      // parallelised independently. Scenario files are named `*.e2e.ts` so the
      // default `apps/*` (qcms-api) project - which globs `*.test.ts` - never
      // double-runs them. Kept inside `pnpm test` via apps/api's test script.
      {
        extends: true,
        test: {
          name: "qcms-api-e2e",
          root: API_ROOT,
          include: ["e2e/**/*.e2e.ts"],
          // Each scenario file boots its own Testcontainers Postgres; give the
          // suite room for image pull + boot on a cold CI runner.
          //
          // The two are deliberately unequal since issue #746. A boot is the only
          // thing here that stretches with how many other containers the machine is
          // starting at the same moment, and 120s stopped covering that during a
          // forced turbo run with 18 uncached tasks (three files in three lanes
          // failed their hook on 2026-08-31 and each passed in seconds alone). The
          // hook budget is doubled to match `CONTAINER_BOOT_TIMEOUT_MS` in
          // `@qcms/db/testing`, which is where the same number lives for every other
          // integration file. The per-TEST budget stays where it was on purpose: a
          // scenario running against a container that is already up and taking
          // minutes is a defect, and widening this would hide it.
          testTimeout: 120_000,
          hookTimeout: 240_000,
        },
      },
      // The scaffolding CLI's adopter-level e2e (task 037): the same arrangement as
      // `qcms-api-e2e` above, and for the same reason. It drives a Docker Compose
      // stack built from a freshly scaffolded project, so it can only run once
      // `pnpm qcms:scaffold-e2e` has stood that stack up, and must therefore stay
      // out of `pnpm test`. Its files are named `*.e2e.ts` so the default
      // `packages/*` project (create-qcms-app, which globs `*.test.ts`) never
      // double-runs them.
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
      // Repo tooling that is neither a package nor an app: the dev container's
      // provisioning helpers and the loop supervisor (task 046). Both are shell,
      // driven here by spawning them - ADR-23 keeps Vitest as the only runner
      // below the browser, so no bats or shunit2.
      //
      // These files are run but neither typechecked nor linted. Typechecking
      // them would mean a root tsconfig and hoisting @types/node to the root,
      // which is more dependency surface than shell-driving test files justify;
      // ESLint's project service does not pick up files outside packages/ and
      // apps/, so the `no any` / `no as` rules are unenforced here too. Both
      // gaps are deliberate: what these assert is process exit codes and stderr
      // strings, so the risk either gate would catch is small. Revisit if this
      // project ever grows tests with real type surface.
      {
        extends: true,
        test: {
          name: "tooling",
          root: REPO_ROOT,
          include: ["scripts/**/*.test.ts", ".devcontainer/**/*.test.ts"],
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
