import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The per-run worker budget, as a percentage so it scales on a small CI runner.
 *
 * It lives in a constant because Vitest 5.0.4 made `maxWorkers` a **per-project**
 * option, so it has to be written onto every project rather than once at the top of
 * the `test` block. The `maxWorkers` comment below carries the measurement and the
 * failure this prevents.
 */
const MAX_WORKERS = "25%";

/**
 * The options Vitest 5 resolves PER PROJECT that this repository needs on every one
 * of them, written onto each project entry because neither a glob nor `extends`
 * inside a project's own config file carries them (see {@link workspaceProjects}).
 *
 * `fsModuleCache` is off, which is where it effectively was until vitest 5.0.4
 * turned it on by default. The cache is one directory, `node_modules/.vitest-cache`,
 * shared by every Vitest process in the checkout, and invalidating it is an
 * `rm -rf` of that directory - while `pnpm test` runs ten Vitest processes at once,
 * one per turbo task, in exactly that checkout. The result is a startup error in
 * whichever process was writing when another cleared: `ENOTEMPTY: directory not
 * empty, rmdir '<repo>/node_modules/.vitest-cache'`, seen once on a `pnpm verify`
 * here and indistinguishable from a real failure in the task it reds. A per-project
 * `fsModuleCachePath` does not fix it, because the clear always includes the shared
 * root as well as each project's own path, and a per-process path would never be
 * read twice and so would only litter. Turning it off restores the 5.0.3 behaviour
 * this suite was measured on, at the cost of a transform cache that cannot be shared
 * safely by concurrent runs in one working tree.
 */
const PROJECT_DEFAULTS = { maxWorkers: MAX_WORKERS, fsModuleCache: false } as const;

/**
 * Every workspace directory under `parent`, as a project entry carrying
 * {@link PROJECT_DEFAULTS}.
 *
 * This replaces the `"packages/*"` and `"apps/*"` globs it is called with, and it
 * resolves the same set the same way: one project per directory that has a
 * `package.json`, named by that manifest, using the directory's own Vitest config
 * when it has one. The one thing it adds is the worker budget, and that is the whole
 * point - a glob cannot carry one, because a globbed directory's project is built
 * from whatever its own directory declares and a directory with no config declares
 * nothing.
 *
 * The two shapes are both measured through the Vitest node API rather than assumed:
 *
 * - **A directory with its own config** is handed over as `extends: <that path>`,
 *   which keeps the file deciding the project's environment, setup files and
 *   includes, with `maxWorkers` added on top. `extends` INSIDE such a file does not
 *   work for this option - `extends: true` and an explicit path both still resolved
 *   the default - which is why the budget is applied from here instead.
 * - **A directory without one** becomes an inline project, the only place its name
 *   and root can come from, and `extends: true` additionally gives it anything else
 *   this file's `test` block grows later.
 *
 * `name` is passed in both shapes because Vitest names an inline entry by its index
 * when the entry does not say otherwise, and this repository addresses its projects
 * by name everywhere: `--project <name>` in a dozen package scripts, in
 * `apps/portal/e2e/support/harness-config.ts`, and in the developer guide.
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

// An absolute path to apps/api, resolved from this config file (not the process
// cwd). An inline project's `root` is resolved relative to the CWD, so a bare
// "apps/api" breaks when Vitest runs from inside apps/api (turbo's `pnpm test`,
// cwd = apps/api) - it would look for apps/api/apps/api and find nothing.
const API_ROOT = fileURLToPath(new URL("apps/api", import.meta.url));

// Repo root, resolved from this file for the same reason API_ROOT is.
const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));

// The scaffolding CLI's root, resolved the same way API_ROOT is.
const CREATE_APP_ROOT = fileURLToPath(new URL("packages/create-qcms-app", import.meta.url));

// Where the coverage reports are written, resolved from this file for the same
// reason API_ROOT is. `scripts/check-coverage-measured.mjs` resolves the same
// directory from its own location; the two have to agree.
const COVERAGE_DIR = fileURLToPath(new URL("coverage", import.meta.url));

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
    //
    // **This number only reaches a project that is given it**, which is what
    // `workspaceProjects` above exists for. Vitest 5.0.4 turned `maxWorkers`
    // from a run-level knob into a per-project one, scheduling each group of specs
    // at `spec.project.config.maxWorkers` rather than at the root's, so under the
    // `"packages/*"` and `"apps/*"` globs this cap silently stopped applying to
    // twelve of the fifteen projects: measured through the Vitest node API on this
    // config at 5.0.5, the three projects declared inline resolved 6 ("25%" of 24
    // cores) and the twelve globbed ones resolved 23, the default of one less than
    // the core count. Two unequal budgets in one scheduling group are also a hard
    // refusal - "Projects ... have different 'maxWorkers' but same
    // 'sequence.groupOrder'" - which killed every command that runs more than one
    // project: `apps/api`'s `test` script (`qcms-api` with `qcms-api-e2e`),
    // `apps/admin`'s (`qcms-admin` with `qcms-admin-dom`), and any run that reaches
    // both `tooling` and a package. At 5.0.3 a globbed project resolved no value at
    // all, so the refusal could not fire and the gap was invisible; it fires on
    // every host where "25%" is not 1, which is every host but a two-core CI runner.
    // With the enumeration above, all fifteen resolve 6 and the refusal is moot.
    //
    // This one is the budget of a run driven from this file directly rather than
    // through a project, which is every `--project <name>` invocation's own root.
    // It is also what the three projects declared inline below inherit, since
    // `extends: true` does carry this block into an inline entry; only a glob and a
    // separate project config file do not.
    ...PROJECT_DEFAULTS,
    projects: [
      // What `"packages/*"` and `"apps/*"` used to be, plus the worker budget a glob
      // cannot carry. See `workspaceProjects`.
      ...workspaceProjects("packages"),
      ...workspaceProjects("apps"),
      // The admin's second project (issue #352): `.tsx` tests under jsdom with
      // testing-library, so a component can be rendered and driven rather than only
      // stringified. Listed explicitly because `workspaceProjects` above takes one
      // config per directory, so a sibling config file is invisible to it. Both admin
      // projects live in `apps/admin/` and share their `@/` alias; the split between
      // them is by file extension and is documented in each. `name` is repeated here
      // rather than left to the file because an entry that extends a path is named by
      // its index otherwise, and the budget rides along for the reason above.
      {
        extends: "apps/admin/vitest.dom.config.ts",
        test: {
          name: "qcms-admin-dom",
          root: fileURLToPath(new URL("apps/admin", import.meta.url)),
          ...PROJECT_DEFAULTS,
        },
      },
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
          // `@roonga/qcms-db/testing`, which is where the same number lives for every other
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
    // Coverage is still a root-level concern: `coverage` is one of Vitest's
    // non-project options, so no project can carry its own (Vitest 5 keeps it
    // in `NonProjectOptions`). Scope: the kernel (task 009 exit criterion 4 -
    // lines >= 95% across tasks 002-009, `pnpm --filter @roonga/qcms-core
    // coverage`). Test files are excluded by Vitest's defaults.
    //
    // `include` is matched against each file's path RELATIVE TO ITS PROJECT
    // ROOT. That is a Vitest 5 breaking change - "coverage.include and
    // coverage.exclude now match precisely", https://vitest.dev/guide/migration
    // and https://vitest.dev/config/coverage - and it is why this pattern is
    // `src/**` rather than the repo-relative `packages/core/src/**` it read
    // under Vitest 4. The old spelling matched nothing once the pattern was
    // resolved against `packages/core`, so the run reported
    // `Lines: Unknown% ( 0/0 )` and still exited 0 against the threshold
    // below: a green that measured no lines at all (PR #970 review).
    //
    // The same pattern would resolve against any other project's root if one
    // were ever run with `--coverage`. The kernel is the only coverage
    // invocation in this repository, and the guard below is scoped to it.
    //
    // That zero-file green cannot recur silently. Vitest has no "fail on an
    // empty report" option, so `packages/core`'s `coverage` script chains
    // `scripts/check-coverage-measured.mjs`, which reads the json-summary
    // written here and fails unless every kernel source file git knows about
    // was measured.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // `text` for whoever is reading the run, `json-summary` for the guard.
      reporter: ["text", "json-summary"],
      // Pinned to this file's directory rather than left to default relative to
      // whatever `--root` an invocation passed, so the guard cannot read a
      // report some other run left behind.
      reportsDirectory: COVERAGE_DIR,
      thresholds: {
        lines: 95,
      },
    },
  },
});
