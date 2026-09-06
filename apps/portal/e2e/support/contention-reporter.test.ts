import { describe, expect, it } from "vitest";

import type { TestCase, TestResult } from "@playwright/test/reporter";

import ContentionReporter, { failureText } from "./contention-reporter.js";
import type { HostSnapshot } from "./contention.js";

/** A quiet machine, so nothing in these tests turns on the neighbour branch. */
const QUIET: HostSnapshot = {
  at: "1970-01-01T00:00:00.000Z",
  load: undefined,
  neighbours: [],
  containers: undefined,
};

/**
 * A stand-in for one `TestCase`, named by the outcome Playwright would compute for it.
 *
 * `outcome()` is stubbed rather than derived, because deriving it would mean copying
 * Playwright's rule into this file and then testing the copy. The rule itself
 * (playwright 1.62.1, `computeTestCaseOutcome`) is: every attempt matching
 * `expectedStatus` is `expected`, none matching is `unexpected`, a mix is `flaky`. The
 * pairs each fixture below stands for are written at its call site, and the property
 * under test is the one that matters here - the reporter asks the outcome and never the
 * raw status.
 */
function testCase(title: string, outcome: ReturnType<TestCase["outcome"]>): TestCase {
  return {
    titlePath: () => ["", "resume.pw.ts", title],
    outcome: () => outcome,
  } as unknown as TestCase;
}

/** A failing attempt, with text that carries no contention signature. */
function failedResult(message = "expect(received).toBeVisible()"): TestResult {
  return { status: "failed", errors: [{ message }] } as unknown as TestResult;
}

/** A reporter wired to a fake machine and a captured stdout. */
function harness() {
  const printed: string[] = [];
  let samples = 0;
  const reporter = new ContentionReporter({
    seat: 4,
    write: (text) => printed.push(text),
    snapshotHost: () => {
      samples += 1;
      return QUIET;
    },
  });
  return {
    reporter,
    output: () => printed.join(""),
    sampleCount: () => samples,
  };
}

describe("failureText", () => {
  it("gathers every place a result names what went wrong", () => {
    const result = {
      status: "failed",
      errors: [{ message: "first", stack: "at one" }],
      error: { message: "second", stack: "at two" },
    } as unknown as TestResult;
    const text = failureText(result);
    for (const fragment of ["first", "at one", "second", "at two"]) {
      expect(text).toContain(fragment);
    }
  });
});

describe("ContentionReporter", () => {
  it("prints nothing for a test.fail whose body failed as expected (issue #828)", () => {
    // The real case: apps/portal/e2e/resume.pw.ts carries a `test.fail` marker for the
    // open #804 hydration defect. Its result status is "failed" and its expected status
    // is "failed" too, so Playwright's outcome is "expected" and the RUN IS GREEN. The
    // first cut of this reporter counted the status, so a 291-test green run printed the
    // whole contention block and claimed one failing test. A report that shows up on
    // green runs is a report nobody reads on the red run it was built for.
    const { reporter, output, sampleCount } = harness();
    reporter.onBegin();
    reporter.onTestEnd(testCase("hydrates without a mismatch", "expected"), failedResult());
    reporter.onEnd();

    expect(output()).toBe("");
    // And it does not pay for the end-of-run host sample either: one sample, at begin.
    expect(sampleCount()).toBe(1);
  });

  it("still prints for a failure nothing expected", () => {
    const { reporter, output } = harness();
    reporter.onBegin();
    reporter.onTestEnd(
      testCase("submits the last step", "unexpected"),
      failedResult("connect ECONNREFUSED 127.0.0.1:17410"),
    );
    reporter.onEnd();

    const report = output();
    expect(report).toContain("cross-lane contention report");
    expect(report).toContain("seat 4, 1 failing test");
    expect(report).toContain("resume.pw.ts > submits the last step: connection refused");
  });

  it("counts an expected failure out of a report a real failure triggered", () => {
    const { reporter, output } = harness();
    reporter.onBegin();
    reporter.onTestEnd(testCase("hydrates without a mismatch", "expected"), failedResult());
    reporter.onTestEnd(
      testCase("submits the last step", "unexpected"),
      failedResult("Error: socket hang up"),
    );
    reporter.onEnd();

    const report = output();
    expect(report).toContain("seat 4, 1 failing test");
    expect(report).toContain("1 of 1 failures match a resource-contention shape");
    expect(report).toContain("submits the last step: connection dropped");
    expect(report).not.toContain("hydrates without a mismatch");
  });

  it("prints nothing for a flake a retry recovered", () => {
    // Decided and written down: flaky prints nothing. A recovered test leaves the run
    // green with exit code 0, and this block's prose counts "failing tests" and closes
    // with "the run still failed", so printing it over a green run would be false as
    // well as re-teaching the habit #828 is about. Retries are CI-only here
    // (playwright.config.ts sets retries: 0 locally), and CI's own summary names every
    // flaky test. Cross-lane attribution for flakes would need its own wording.
    const { reporter, output } = harness();
    const flaky = testCase("submits the last step", "flaky");
    reporter.onBegin();
    reporter.onTestEnd(flaky, failedResult("socket hang up")); // first attempt
    reporter.onEnd(); // the retry passed, so no second onTestEnd for a failure

    expect(output()).toBe("");
  });

  it("counts a test that failed every attempt once, not once per attempt", () => {
    // Retries make onTestEnd fire more than once for one test. A count of attempts
    // would tell the reader there were two failing tests when there was one.
    const { reporter, output } = harness();
    const doomed = testCase("submits the last step", "unexpected");
    reporter.onBegin();
    reporter.onTestEnd(doomed, failedResult());
    reporter.onTestEnd(doomed, failedResult("socket hang up"));
    reporter.onEnd();

    const report = output();
    expect(report).toContain("seat 4, 1 failing test");
    // The last attempt's text is the one classified, since that is the one a reader
    // goes looking at first.
    expect(report).toContain("submits the last step: connection dropped");
  });

  it("counts a timeout nothing expected as a failure", () => {
    const { reporter, output } = harness();
    reporter.onBegin();
    reporter.onTestEnd(testCase("waits for the API", "unexpected"), {
      status: "timedOut",
      errors: [{ message: "Test timeout of 60000ms exceeded." }],
    } as unknown as TestResult);
    reporter.onEnd();

    expect(output()).toContain("seat 4, 1 failing test");
  });

  it("says at the start when another seat's harness is up, whatever the run does later", () => {
    const printed: string[] = [];
    const busy: HostSnapshot = {
      ...QUIET,
      neighbours: [{ seat: 3, service: "admin", port: 17340, pid: 9, cwd: "/w/other" }],
    };
    const reporter = new ContentionReporter({
      seat: 4,
      write: (text) => printed.push(text),
      snapshotHost: () => busy,
    });
    reporter.onBegin();
    reporter.onEnd();

    expect(printed.join("")).toContain("seat 4 is NOT alone");
    // The start notice is all a green run gets: no report follows it.
    expect(printed.join("")).not.toContain("cross-lane contention report");
  });

  it("degrades to an unknown snapshot rather than throwing out of a Playwright hook", () => {
    const printed: string[] = [];
    const reporter = new ContentionReporter({
      seat: 4,
      write: (text) => printed.push(text),
      snapshotHost: () => {
        throw new Error("/proc is not readable here");
      },
    });
    expect(() => {
      reporter.onBegin();
      reporter.onTestEnd(testCase("submits the last step", "unexpected"), failedResult());
      reporter.onEnd();
    }).not.toThrow();
    expect(printed.join("")).toContain("none occupied");
  });
});
