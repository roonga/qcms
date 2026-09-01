import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ASSERT_ACTION,
  JOB_GUARDS,
  MIRROR_ACTION,
  compareGuards,
  jobsIn,
} from "./check-docker-job-guards.mjs";

/**
 * Tests for the Docker-job guard lint (issue #155, deferred from #150).
 *
 * #155 asks for the bite to be proven rather than inspected, so every case below drives
 * a synthetic workflow through the real comparator: a Testcontainers job missing each
 * action in turn, a job nobody classified, an entry naming a job that no longer exists,
 * and a job wired to a guard its class says it does not need. The positive control is
 * the same comparator over the repository's own workflows, which must be silent.
 */

const workflow = (body: string): string => ["name: X", "on: push", "jobs:", body].join("\n");

const TESTCONTAINERS_JOB = [
  "  unit:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v7",
  `      - uses: ./.github/actions/${MIRROR_ACTION}`,
  "      - run: pnpm test",
  `      - uses: ./.github/actions/${ASSERT_ACTION}`,
].join("\n");

/** The classification a correctly wired Testcontainers job would carry. */
const GUARDED = { "x.yml#unit": { mirror: true, assert: true, why: "boots Testcontainers." } };

describe("jobsIn", () => {
  it("reads each job and the local actions it references", () => {
    expect(jobsIn(workflow(TESTCONTAINERS_JOB))).toEqual([
      { job: "unit", actions: [MIRROR_ACTION, ASSERT_ACTION] },
    ]);
  });

  it("separates jobs, so one job's action does not cover the next", () => {
    const two = jobsIn(workflow([TESTCONTAINERS_JOB, "  lint:", "    steps: []"].join("\n")));

    expect(two.map((entry) => entry.job)).toEqual(["unit", "lint"]);
    expect(two[1]?.actions).toEqual([]);
  });

  it("does not mistake a run-body line for a job key", () => {
    // A block scalar is indented deeper than the job key it sits under, so the shape
    // read here cannot be produced by a shell script inside a step.
    const withScript = jobsIn(
      workflow(
        [
          "  unit:",
          "    steps:",
          "      - run: |",
          "          echo 'evil:'",
          "          echo 'done'",
        ].join("\n"),
      ),
    );

    expect(withScript.map((entry) => entry.job)).toEqual(["unit"]);
  });
});

describe("compareGuards", () => {
  it("is silent when a Docker-backed job carries both actions", () => {
    expect(compareGuards(jobsInKeyed(TESTCONTAINERS_JOB), GUARDED)).toEqual([]);
  });

  it("bites when the mirror action is missing", () => {
    const missing = TESTCONTAINERS_JOB.split("\n").filter((line) => !line.includes(MIRROR_ACTION));

    const problems = compareGuards(jobsInKeyed(missing.join("\n")), GUARDED);

    expect(problems.join("\n")).toContain(MIRROR_ACTION);
    expect(problems).not.toEqual([]);
  });

  it("bites when the Hub assertion is missing", () => {
    const missing = TESTCONTAINERS_JOB.split("\n").filter((line) => !line.includes(ASSERT_ACTION));

    const problems = compareGuards(jobsInKeyed(missing.join("\n")), GUARDED);

    expect(problems.join("\n")).toContain(ASSERT_ACTION);
  });

  it("bites on a job nobody classified, which is how a new job gets noticed", () => {
    const problems = compareGuards(jobsInKeyed(TESTCONTAINERS_JOB), {});

    expect(problems.join("\n")).toContain("not classified");
  });

  it("bites on a classification for a job that no longer exists", () => {
    const problems = compareGuards(jobsInKeyed(TESTCONTAINERS_JOB), {
      ...GUARDED,
      "x.yml#gone": { mirror: true, assert: true, why: "removed in a refactor." },
    });

    expect(problems.join("\n")).toContain("no such job exists");
  });

  it("bites on a job wired to a guard its class says it does not need", () => {
    const problems = compareGuards(jobsInKeyed(TESTCONTAINERS_JOB), {
      "x.yml#unit": { mirror: true, assert: false, why: "builds images from an unmirrored base." },
    });

    expect(problems.join("\n")).toContain("while classified as not needing it");
  });

  it("passes over the repository's own workflows", () => {
    // The no-false-positives control #155 asks for: green on the real tree, every job
    // classified, every entry naming a job that exists. This is the same comparison the
    // gate runs, so a workflow edited without its classification fails here too.
    const dir = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
    const declared = readdirSync(dir)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort()
      .flatMap((file) =>
        jobsIn(readFileSync(join(dir, file), "utf8")).map((entry) => ({
          ...entry,
          job: `${file}#${entry.job}`,
        })),
      );

    expect(declared.length).toBeGreaterThan(0);
    expect(compareGuards(declared, JOB_GUARDS)).toEqual([]);
  });
});

/** The comparator takes `<workflow>#<job>` keys; the fixtures above are one file. */
function jobsInKeyed(body: string): { job: string; actions: string[] }[] {
  return jobsIn(workflow(body)).map((entry) => ({ ...entry, job: `x.yml#${entry.job}` }));
}
