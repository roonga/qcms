import { describe, expect, it } from "vitest";

import {
  DEFAULTS,
  durationSeconds,
  minutes,
  nearestRank,
  parseArgs,
  render,
  sampleFrom,
  summarize,
} from "./ci-job-durations.mjs";

/**
 * The refresh command behind the CONTRIBUTING figures (issue #858).
 *
 * What is worth pinning here is the arithmetic, not the API plumbing: the whole point of
 * the script is that a number in a document can be re-derived, so a p50 that is quietly
 * off by one rank would reintroduce exactly the wrong-number problem it exists to fix.
 * The fixed array below is therefore the unit under test, and the network path is left to
 * the command itself.
 */

/**
 * Fourteen durations in seconds, deliberately unsorted and of even length, so the
 * nearest-rank choice (an observed sample) is distinguishable from an interpolated
 * median (the mean of the two middle values, 1768.5 here).
 */
const SECONDS = [
  1841, 1598, 1887, 1884, 1859, 1835, 1478, 1498, 1745, 1713, 1762, 1765, 1872, 1772,
];

const ASCENDING = [...SECONDS].sort((a, b) => a - b);

describe("nearestRank", () => {
  it("takes the smallest sample at or above the rank, never an interpolated value", () => {
    // ceil(0.5 * 14) = 7, so the 7th smallest: 1765, not (1765 + 1772) / 2.
    expect(nearestRank(ASCENDING, 50)).toBe(1765);
    expect(nearestRank(ASCENDING, 90)).toBe(1884);
    expect(ASCENDING).toContain(nearestRank(ASCENDING, 50));
  });

  it("returns the extremes at the ends of the range", () => {
    expect(nearestRank(ASCENDING, 100)).toBe(1887);
    expect(nearestRank(ASCENDING, 1)).toBe(1478);
  });

  it("handles an odd count and a single sample", () => {
    expect(nearestRank([1, 2, 3], 50)).toBe(2);
    expect(nearestRank([1, 2, 3, 4, 5], 90)).toBe(5);
    expect(nearestRank([42], 50)).toBe(42);
    expect(nearestRank([42], 100)).toBe(42);
  });

  it("refuses an empty array or a percentile outside (0, 100]", () => {
    expect(() => nearestRank([], 50)).toThrow(/at least one sample/);
    expect(() => nearestRank([1, 2], 0)).toThrow(/\(0, 100]/);
    expect(() => nearestRank([1, 2], 101)).toThrow(/\(0, 100]/);
  });
});

describe("durationSeconds", () => {
  it("measures whole seconds between two ISO-8601 instants", () => {
    expect(durationSeconds("2026-09-08T21:30:47Z", "2026-09-08T22:01:28Z")).toBe(1841);
  });

  it("crosses a day boundary", () => {
    expect(durationSeconds("2026-09-07T23:50:00Z", "2026-09-08T00:20:00Z")).toBe(1800);
  });

  it("refuses timestamps it cannot parse", () => {
    expect(() => durationSeconds("not-a-date", "2026-09-08T00:00:00Z")).toThrow(/unparseable/);
  });
});

describe("summarize", () => {
  const samples = SECONDS.map((seconds, index) => ({
    runId: 1000 + index,
    startedAt: `2026-09-0${String((index % 3) + 6)}T0${String(index % 10)}:00:00Z`,
    completedAt: `2026-09-0${String((index % 3) + 6)}T0${String(index % 10)}:30:00Z`,
    seconds,
  }));

  it("reports the percentiles, the extremes and the sampled date range", () => {
    const summary = summarize("browser-e2e", samples, 40);

    expect(summary.count).toBe(14);
    expect(summary.scanned).toBe(40);
    expect(summary.p50).toBe(1765);
    expect(summary.p90).toBe(1884);
    expect(summary.max).toBe(1887);
    expect(summary.min).toBe(1478);
    expect(summary.earliest).toBe("2026-09-06");
    expect(summary.latest).toBe("2026-09-08");
  });

  it("survives a job that no scanned run carried, rather than dividing by zero", () => {
    const summary = summarize("portal-e2e", [], 40);

    expect(summary.count).toBe(0);
    expect(summary.p50).toBe(0);
    expect(render(summary)).toBe(
      "ci-job-durations: no 'portal-e2e' job in the last 40 successful runs",
    );
  });

  it("names the jobs it did see, deduplicated and sorted, when it found none", () => {
    // The likeliest reason for an empty result is a name that is nearly right: a matrix
    // job's real name carries its suffix, so 'verify' matches nothing while
    // 'verify (node-24)' matches every run. A list answers that; a bare refusal does not.
    const summary = summarize("verify", [], 3, [
      "verify (node-26)",
      "browser-e2e",
      "verify (node-24)",
      "browser-e2e",
    ]);

    expect(summary.namesSeen).toEqual(["browser-e2e", "verify (node-24)", "verify (node-26)"]);
    expect(render(summary)).toBe(
      [
        "ci-job-durations: no 'verify' job in the last 3 successful runs. Job names seen:",
        "  browser-e2e",
        "  verify (node-24)",
        "  verify (node-26)",
      ].join("\n"),
    );
  });

  it("renders minutes to one decimal place", () => {
    expect(minutes(1765)).toBe("29.4");
    expect(render(summarize("browser-e2e", samples, 40))).toContain(
      "browser-e2e: p50 29.4 / p90 31.4 / max 31.4 minutes",
    );
  });
});

describe("sampleFrom", () => {
  const jobs = [
    {
      name: "verify (node-24)",
      conclusion: "success",
      started_at: "2026-09-08T21:30:47Z",
      completed_at: "2026-09-08T22:01:28Z",
    },
    {
      name: "browser-e2e",
      conclusion: "failure",
      started_at: "2026-09-08T21:30:47Z",
      completed_at: "2026-09-08T21:40:47Z",
    },
    {
      name: "api-e2e",
      conclusion: "success",
      started_at: "2026-09-08T21:30:47Z",
      completed_at: null,
    },
  ];

  it("matches the job name exactly, suffix and all", () => {
    expect(sampleFrom(jobs, 7, "verify (node-24)")).toEqual({
      runId: 7,
      startedAt: "2026-09-08T21:30:47Z",
      completedAt: "2026-09-08T22:01:28Z",
      seconds: 1841,
    });
    expect(sampleFrom(jobs, 7, "verify")).toBeUndefined();
  });

  it("ignores a job that did not succeed or has not finished", () => {
    expect(sampleFrom(jobs, 7, "browser-e2e")).toBeUndefined();
    expect(sampleFrom(jobs, 7, "api-e2e")).toBeUndefined();
  });
});

describe("parseArgs", () => {
  it("takes a job name and fills the rest from the defaults", () => {
    expect(parseArgs(["browser-e2e"])).toEqual({ job: "browser-e2e", ...DEFAULTS, json: false });
  });

  it("accepts the overrides", () => {
    expect(parseArgs(["verify", "--runs", "5", "--branch", "next", "--json"])).toEqual({
      job: "verify",
      workflow: DEFAULTS.workflow,
      branch: "next",
      runs: 5,
      json: true,
    });
  });

  it("refuses a missing job, a second job, an unknown flag and a non-positive count", () => {
    expect(() => parseArgs([])).toThrow(/usage: pnpm ci:durations/);
    // The usage line has to name every option the header documents, or it sends the
    // next person looking for a flag that is right there.
    expect(() => parseArgs([])).toThrow(/--workflow W/);
    expect(() => parseArgs(["a", "b"])).toThrow(/only one job name/);
    expect(() => parseArgs(["a", "--nope"])).toThrow(/unknown option/);
    expect(() => parseArgs(["a", "--runs", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["a", "--branch"])).toThrow(/needs a value/);
  });
});
