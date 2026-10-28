#!/usr/bin/env node
// @ts-check
/**
 * The classification is total in both directions - every job must appear and every
 * entry must name a real job - because a heuristic that misses a job is
 * indistinguishable from a job that needs no guard.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKFLOWS = ".github/workflows";

export const MIRROR_ACTION = "test-postgres-image";

export const ASSERT_ACTION = "assert-no-docker-hub-pulls";

/**
 * The GHCR mirror was declined for the base image and the BuildKit frontend, so this
 * retried pre-pull is the whole of their availability story.
 */
export const PREPULL_ACTION = "prepull-base-images";

/**
 * Keyed `<workflow file>#<job id>`. Each flag is exact in both directions: `false`
 * means the job must NOT reference that action.
 *
 * @type {Record<string, { mirror: boolean; assert: boolean; prepull: boolean; why: string }>}
 */
export const JOB_GUARDS = {
  "audit.yml#audit": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "reads the dependency tree and files an issue. No container is started.",
  },
  "ci.yml#changes": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "the fast-lane classifier: a checkout and one node invocation over a git diff.",
  },
  "ci.yml#verify": {
    mirror: true,
    assert: true,
    prepull: false,
    why: "`pnpm test` includes @roonga/qcms-db's integration suites, which boot a Testcontainers Postgres per file.",
  },
  "ci.yml#api-e2e": {
    mirror: true,
    assert: true,
    prepull: false,
    why: "each of the API scenario files boots its own Testcontainers Postgres.",
  },
  "ci.yml#browser-e2e": {
    mirror: true,
    assert: true,
    prepull: false,
    why: "the Playwright globalSetup boots a Testcontainers Postgres and composes the API against it.",
  },
  "codeql.yml#analyze": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "GitHub-hosted static analysis. No Docker on the path at all.",
  },
  "create-app-e2e.yml#create-app-e2e": {
    mirror: true,
    assert: false,
    prepull: true,
    why: "scaffolds an adopter project and boots its Compose topology on the mirrored Postgres, so it needs the mirror. It BUILDS the three application images from the scaffolded tree, so it needs the pre-pull too: the scaffolded Dockerfiles carry the same Docker Hub base and the same `docker/dockerfile:1` frontend, and the templates must keep a public default that resolves for an adopter who has never heard of this repository, so a mirror was never an option there. Deliberately outside the Hub assertion for the same build-time reason as full-stack-e2e: the pull is the job's own, and the assertion would fail on it.",
  },
  "e2e.yml#changes": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "the same fast-lane classifier as ci.yml's, in the workflow that needs its own copy.",
  },
  "e2e.yml#full-stack-e2e": {
    mirror: true,
    assert: false,
    prepull: true,
    why: "boots the Compose topology on the mirrored Postgres, so it needs the mirror, and BUILDS the three application images, so it needs the pre-pull: they are FROM node:24-bookworm-slim and name the `docker/dockerfile:1` frontend, neither of which is mirrored, which is a decision rather than a gap (issue #1050). It is deliberately outside the Hub assertion, and the reason survives the change: the Hub pull is now this job's own deliberate one, made before the assertion's baseline is taken. The job says so in a comment of its own.",
  },
  "images.yml#build": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "builds the three release images on every push and publishes them to GHCR on main (issue #763). It needs no test Postgres, and it is outside the Hub assertion for the same build-time reason as full-stack-e2e plus the SBOM scanner image; its own registry traffic goes to ghcr.io on the built-in token, not to the Hub. It is the one image-building job classified `prepull: false`, and not from oversight: `--sbom` forces a docker-container driver builder, which keeps its own content store and asks the registry whatever is on the daemon, so a pre-pull cannot reach it (measured, issue #1050). It carries `scripts/retry-registry.sh` around the build instead, which is the narrowest place left. Documented in the workflow.",
  },
  "images.yml#scan": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "runs grype over the SPDX SBOM the build job persisted (issue #894). It starts no container and pulls no image: the SBOM arrives as a workflow artifact and the vulnerability database comes from the scanner's own endpoint, so neither guard applies.",
  },
  "images.yml#scan-issue": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "reads the scan report artifact and files or updates one labeled issue on the scheduled run, the way audit.yml does. No container is started and no registry is contacted.",
  },
  "mirror-test-images.yml#mirror": {
    mirror: false,
    assert: false,
    prepull: false,
    why: "this job IS the mirror: it copies the upstream image into GHCR, so a registry call to Docker Hub is its purpose rather than a leak.",
  },
  "restore-drill.yml#drill": {
    mirror: true,
    assert: false,
    prepull: true,
    why: "runs the backup-and-restore drill against the mirrored Postgres through Compose, and brings the application images up, so it builds them: mirror and pre-pull both. The pre-pull matters most here, because this workflow runs on a schedule, so a Hub blip fails a run nobody is watching and the drill's whole value is that it ran. Outside the Hub assertion for the same build-time reason as full-stack-e2e.",
  },
};

/**
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
 * @param {{ job: string; actions: string[] }[]} declared
 * @param {Record<string, { mirror: boolean; assert: boolean; prepull: boolean; why: string }>} guards
 * @returns {string[]}
 */
export function compareGuards(declared, guards) {
  const problems = [];
  const seen = new Set();
  // An action absent from this set is neither required nor refused.
  const modelled = [MIRROR_ACTION, ASSERT_ACTION, PREPULL_ACTION];

  for (const { job, actions } of declared) {
    seen.add(job);
    const entry = guards[job];
    if (entry === undefined) {
      problems.push(
        `  ${job}: not classified. Add it to JOB_GUARDS with the three flags and the reason.`,
      );
      continue;
    }
    const expected = [
      ...(entry.mirror ? [MIRROR_ACTION] : []),
      ...(entry.assert ? [ASSERT_ACTION] : []),
      ...(entry.prepull ? [PREPULL_ACTION] : []),
    ];
    for (const action of expected) {
      if (!actions.includes(action)) {
        problems.push(`  ${job}: classified as needing ./.github/actions/${action}, and does not`);
        problems.push(`      use it. ${entry.why}`);
      }
    }
    for (const action of actions) {
      if (!expected.includes(action) && modelled.includes(action)) {
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
      `(./.github/actions/${ASSERT_ACTION}). A job that BUILDS the application images`,
      `must pre-pull the Docker Hub base and BuildKit frontend with retries`,
      `(./.github/actions/${PREPULL_ACTION}), because neither is mirrored. The`,
      "classification in this script is total: every job in every workflow is in it, so",
      "adding a job means deciding, in writing, which guards it needs. See issues #155,",
      "#150 and #1050.",
      "",
    ].join("\n"),
  );
  return 1;
}

// Guarded so an importing test triggers neither the scan nor the `process.exit`.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
