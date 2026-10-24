import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ASSERT_ACTION,
  JOB_GUARDS,
  MIRROR_ACTION,
  PREPULL_ACTION,
  compareGuards,
  jobsIn,
} from "./check-docker-job-guards.mjs";

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

const GUARDED = {
  "x.yml#unit": { mirror: true, assert: true, prepull: false, why: "boots Testcontainers." },
};

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
    // A block scalar is indented deeper than its job key, so a shell script inside a
    // step cannot produce the shape read here.
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
      "x.yml#gone": { mirror: true, assert: true, prepull: false, why: "removed in a refactor." },
    });

    expect(problems.join("\n")).toContain("no such job exists");
  });

  it("bites on a job wired to a guard its class says it does not need", () => {
    const problems = compareGuards(jobsInKeyed(TESTCONTAINERS_JOB), {
      "x.yml#unit": {
        mirror: true,
        assert: false,
        prepull: false,
        why: "builds images from an unmirrored base.",
      },
    });

    expect(problems.join("\n")).toContain("while classified as not needing it");
  });

  it("bites when an image-building job is missing the pre-pull (issue #1050)", () => {
    const buildsImages = {
      "x.yml#unit": {
        mirror: true,
        assert: false,
        prepull: true,
        why: "builds the application images.",
      },
    };

    const missing = compareGuards(jobsInKeyed(TESTCONTAINERS_JOB), buildsImages);
    expect(missing.join("\n")).toContain(PREPULL_ACTION);

    const wired = [TESTCONTAINERS_JOB, `      - uses: ./.github/actions/${PREPULL_ACTION}`]
      .join("\n")
      .split("\n")
      .filter((line) => !line.includes(ASSERT_ACTION))
      .join("\n");
    expect(compareGuards(jobsInKeyed(wired), buildsImages)).toEqual([]);
  });

  it("bites on a pre-pull a job's class says it does not need", () => {
    // A docker-container driver builder keeps its own content store and cannot be served
    // from the daemon's, so the pre-pull action there would read as fixed and change nothing.
    const wired = [TESTCONTAINERS_JOB, `      - uses: ./.github/actions/${PREPULL_ACTION}`].join(
      "\n",
    );

    const problems = compareGuards(jobsInKeyed(wired), GUARDED);

    expect(problems.join("\n")).toContain(PREPULL_ACTION);
    expect(problems.join("\n")).toContain("while classified as not needing it");
  });

  it("passes over the repository's own workflows", () => {
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

function jobsInKeyed(body: string): { job: string; actions: string[] }[] {
  return jobsIn(workflow(body)).map((entry) => ({ ...entry, job: `x.yml#${entry.job}` }));
}
