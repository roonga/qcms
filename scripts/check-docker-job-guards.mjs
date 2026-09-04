#!/usr/bin/env node
// @ts-check
/**
 * Every workflow job is classified, and a Docker-backed one carries its guards
 * (issue #155, deferred from #150).
 *
 * `.github/actions/test-postgres-image` puts the mirrored Postgres on the runner and
 * disables the Ryuk reaper; `.github/actions/assert-no-docker-hub-pulls` proves the
 * run made no Docker Hub call. Both work. Neither guards a job that simply does not
 * mention them, which is the same shape as the defect they exist for: #74's GHCR
 * mirror was in place for weeks while the `verify` job quietly bypassed it. A new
 * Testcontainers job that omitted both would fail nothing and silently reintroduce the
 * Hub dependency #150 removed.
 *
 * ## How "Docker-backed" is decided, and why this way
 *
 * By an explicit classification below, not by a heuristic. The alternatives were
 * considered in #155: matching the script a job runs, or the package whose tests need
 * Docker. Both fail silently in the direction that matters - a new job spelled
 * differently is simply not matched, and a heuristic that misses is indistinguishable
 * from a job that is clean.
 *
 * A list on its own has the same hole (nobody adds the new job to it), so the list is
 * **total**: every job in every workflow must appear, and every entry must name a real
 * job. Adding a job to any workflow fails this gate until someone writes down which of
 * the two actions it needs and why. That is the property #155 asked for - it fails when
 * someone adds a job without thinking, rather than when a pattern misses.
 *
 * The match is exact in both directions: a job must reference the actions its entry
 * names and no others. So a job that gains an action is reclassified deliberately
 * rather than drifting, and no job can reference a guard action while being classified
 * as not needing one.
 *
 * ## What it reads
 *
 * The job keys and the `uses:` lines, by shape rather than with a YAML parser (no
 * dependency for a two-property read). Job keys sit at two spaces under a top-level
 * `jobs:`; every job property is deeper, so a `run: |` body cannot be mistaken for a
 * job. It does not evaluate `if:` conditions: a step guarded off on the plan-only fast
 * lane still counts as referenced, which is correct here - the question is whether the
 * job wires the guard at all.
 *
 * Usage:  node scripts/check-docker-job-guards.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKFLOWS = ".github/workflows";

/** The mirror-and-reaper setup action. */
export const MIRROR_ACTION = "test-postgres-image";

/** The evidence action: zero Docker Hub calls during the run. */
export const ASSERT_ACTION = "assert-no-docker-hub-pulls";

/**
 * Every job in every workflow, and the guard actions it must reference.
 *
 * Keyed `<workflow file>#<job id>`. `mirror` and `assert` are exact requirements: true
 * means the job must reference that action, false means it must not. Every entry
 * carries the reason, because the entries that say `false` for a job that clearly
 * touches Docker are the ones a future reader will want to argue with.
 *
 * @type {Record<string, { mirror: boolean; assert: boolean; why: string }>}
 */
export const JOB_GUARDS = {
  "audit.yml#audit": {
    mirror: false,
    assert: false,
    why: "reads the dependency tree and files an issue. No container is started.",
  },
  "ci.yml#changes": {
    mirror: false,
    assert: false,
    why: "the fast-lane classifier: a checkout and one node invocation over a git diff.",
  },
  "ci.yml#verify": {
    mirror: true,
    assert: true,
    why: "`pnpm test` includes @qcms/db's integration suites, which boot a Testcontainers Postgres per file.",
  },
  "ci.yml#api-e2e": {
    mirror: true,
    assert: true,
    why: "each of the API scenario files boots its own Testcontainers Postgres.",
  },
  "ci.yml#portal-e2e": {
    mirror: true,
    assert: true,
    why: "the Playwright globalSetup boots a Testcontainers Postgres and composes the API against it.",
  },
  "codeql.yml#analyze": {
    mirror: false,
    assert: false,
    why: "GitHub-hosted static analysis. No Docker on the path at all.",
  },
  "create-app-e2e.yml#create-app-e2e": {
    mirror: true,
    assert: false,
    why: "scaffolds an adopter project and boots its Compose topology on the mirrored Postgres, so it needs the mirror. Deliberately outside the Hub assertion for the same build-time reason as full-stack-e2e: it BUILDS the three application images from the scaffolded tree, whose base image is not mirrored, so the assertion would fail on a pull the job legitimately makes.",
  },
  "e2e.yml#changes": {
    mirror: false,
    assert: false,
    why: "the same fast-lane classifier as ci.yml's, in the workflow that needs its own copy.",
  },
  "e2e.yml#full-stack-e2e": {
    mirror: true,
    assert: false,
    why: "boots the Compose topology on the mirrored Postgres, so it needs the mirror. It is deliberately outside the Hub assertion: it BUILDS the three application images, which are FROM node:24-bookworm-slim and not mirrored, so the assertion would fail on a build-time pull the job legitimately makes. The job says so in a comment of its own.",
  },
  "images.yml#build": {
    mirror: false,
    assert: false,
    why: "builds the three release images on every push and publishes them to GHCR on main (issue #763). It needs no test Postgres, and it is outside the Hub assertion for the same build-time reason as full-stack-e2e plus the SBOM scanner image; its own registry traffic goes to ghcr.io on the built-in token, not to the Hub. Documented in the workflow.",
  },
  "mirror-test-images.yml#mirror": {
    mirror: false,
    assert: false,
    why: "this job IS the mirror: it copies the upstream image into GHCR, so a registry call to Docker Hub is its purpose rather than a leak.",
  },
  "restore-drill.yml#drill": {
    mirror: true,
    assert: false,
    why: "runs the backup-and-restore drill against the mirrored Postgres through Compose. Outside the Hub assertion for the same build-time reason as full-stack-e2e: the drill brings the application images up.",
  },
};

/**
 * The jobs a workflow declares, with the local composite actions each one references.
 *
 * @param {string} workflowText
 * @returns {{ job: string; actions: string[] }[]}
 */
export function jobsIn(workflowText) {
  const lines = workflowText.split("\n");
  const jobsAt = lines.findIndex((line) => line === "jobs:");
  if (jobsAt === -1) return [];

  /** @type {{ job: string; actions: string[] }[]} */
  const jobs = [];
  for (const line of lines.slice(jobsAt + 1)) {
    const key = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (key?.[1] !== undefined) {
      jobs.push({ job: key[1], actions: [] });
      continue;
    }
    const uses = /^\s+-?\s*uses:\s*\.\/\.github\/actions\/([A-Za-z0-9_-]+)/.exec(line);
    const current = jobs.at(-1);
    if (uses?.[1] !== undefined && current !== undefined && !current.actions.includes(uses[1])) {
      current.actions.push(uses[1]);
    }
  }
  return jobs;
}

/**
 * Compare the declared jobs against the classification.
 *
 * @param {{ job: string; actions: string[] }[]} declared with `job` already keyed
 *   `<workflow>#<id>`.
 * @param {Record<string, { mirror: boolean; assert: boolean; why: string }>} guards
 * @returns {string[]} one line per problem, empty when the two agree.
 */
export function compareGuards(declared, guards) {
  const problems = [];
  const seen = new Set();

  for (const { job, actions } of declared) {
    seen.add(job);
    const entry = guards[job];
    if (entry === undefined) {
      problems.push(
        `  ${job}: not classified. Add it to JOB_GUARDS with the two flags and the reason.`,
      );
      continue;
    }
    const expected = [
      ...(entry.mirror ? [MIRROR_ACTION] : []),
      ...(entry.assert ? [ASSERT_ACTION] : []),
    ];
    for (const action of expected) {
      if (!actions.includes(action)) {
        problems.push(`  ${job}: classified as needing ./.github/actions/${action}, and does not`);
        problems.push(`      use it. ${entry.why}`);
      }
    }
    for (const action of actions) {
      if (!expected.includes(action) && (action === MIRROR_ACTION || action === ASSERT_ACTION)) {
        problems.push(
          `  ${job}: uses ./.github/actions/${action} while classified as not needing it.`,
        );
        problems.push(`      Reclassify it in JOB_GUARDS, or drop the step. ${entry.why}`);
      }
    }
  }

  for (const job of Object.keys(guards)) {
    if (!seen.has(job)) {
      problems.push(`  ${job}: classified in JOB_GUARDS but no such job exists. Remove the entry.`);
    }
  }

  return problems;
}

/** Run the gate over `.github/workflows`. Returns the process exit code. */
export function main() {
  const dir = join(REPO_ROOT, WORKFLOWS);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  /** @type {{ job: string; actions: string[] }[]} */
  const declared = [];
  for (const file of files) {
    for (const entry of jobsIn(readFileSync(join(dir, file), "utf8"))) {
      declared.push({ job: `${file}#${entry.job}`, actions: entry.actions });
    }
  }

  if (declared.length === 0) {
    console.error(`check-docker-job-guards: no jobs found under ${WORKFLOWS} - has it moved?`);
    return 1;
  }

  const problems = compareGuards(declared, JOB_GUARDS);
  if (problems.length === 0) {
    console.log(
      `check-docker-job-guards: OK - ${String(declared.length)} workflow jobs, each classified, ` +
        "each carrying the Testcontainers guards its class requires.",
    );
    return 0;
  }

  console.error("check-docker-job-guards: workflow jobs and their Docker guards disagree:\n");
  for (const problem of problems) console.error(problem);
  console.error(
    [
      "",
      "A job that boots Testcontainers must set the mirrored image up",
      `(./.github/actions/${MIRROR_ACTION}) and prove it made no Docker Hub call`,
      `(./.github/actions/${ASSERT_ACTION}). The classification in this script is total:`,
      "every job in every workflow is in it, so adding a job means deciding, in writing,",
      "which guards it needs. See issue #155 and issue #150.",
      "",
    ].join("\n"),
  );
  return 1;
}

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
