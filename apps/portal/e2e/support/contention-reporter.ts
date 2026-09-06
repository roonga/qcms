/**
 * The Playwright reporter that says whether this run was alone (issue #395).
 *
 * It is additive to `list`, never a replacement: `list` prints the tests and decides
 * nothing, this prints the neighbourhood and decides nothing either. Together they answer
 * the two questions a red browser gate raises, of which the harness previously answered
 * only the first: *which tests failed*, and *was anything else on this machine competing
 * with them while they did*.
 *
 * ## Why a reporter rather than a fixture or a global hook
 *
 * A reporter is the only seam that sees the whole run: it is constructed before the first
 * spec and it is still alive after the last one, so it can sample the host at both ends
 * and hold the failure list in between. A fixture sees one test, `globalSetup` sees the
 * start and `globalTeardown` sees an end it cannot correlate with results. It also runs in
 * the runner process, which is where `/proc` reads and a `docker ps` belong: doing either
 * from a worker would multiply them by the worker count for no extra information.
 *
 * ## The one rule this reporter has
 *
 * **It annotates, it never suppresses.** It implements no verdict-bearing hook: no
 * `onError` swallowing, no exit-code opinion, no retry, no skip. `onEnd` returns nothing,
 * so Playwright's own status is what it always was. A contention-shaped failure still
 * fails the run, and a green run is never explained away as "contention" either. The value
 * added is entirely in what a human reads afterwards, which is exactly where the cost of
 * issue #395 landed: the run did not lie about the tests, it lied by omission about the
 * machine.
 *
 * ## A failing result is not a failing test (issue #828)
 *
 * The first cut counted `result.status`, and that made the reporter fire on runs with
 * zero real failures. `apps/portal/e2e/resume.pw.ts` carries a deliberate `test.fail`
 * marker for the open NumberField hydration defect (#804): Playwright RUNS that test,
 * the body fails as intended, and the run is green because the outcome was the expected
 * one. The raw result still reads `failed`, so a green 291-test run printed the whole
 * contention block and claimed "1 failing test". A report that appears on green runs is
 * a report operators learn to skip, which costs the one red where it mattered.
 *
 * So the trigger is the **outcome**, not the status. Playwright folds the result status
 * and `TestCase.expectedStatus` together in `TestCase.outcome()`:
 *
 * - `expected` - every attempt matched `expectedStatus`. A `test.fail` that failed is
 *   here, and so is an ordinary pass. Not a failing test, and not reportable.
 * - `unexpected` - no attempt matched. This is the red merge gate the report exists for.
 * - `flaky` - some attempt matched and some did not, which in this config means a retry
 *   recovered it. Deliberately NOT reportable: see below.
 * - `skipped` - never ran.
 *
 * `outcome()` is read in `onEnd` rather than in `onTestEnd`, because it is computed from
 * the results collected SO FAR: at the end of a failing first attempt the retry has not
 * run yet, so a test that will end up flaky still reads `unexpected` there. Only after
 * the last test has ended is the answer final.
 *
 * ### Why flaky prints nothing
 *
 * A flaky test recovered on retry, so the run is green and its exit code is zero. This
 * report's prose is written for a red - it counts "failing tests" and closes with "the
 * run still failed" - and printing it over a green run would state something false as
 * well as re-teaching the habit #828 is about. Retries are CI-only here
 * (`playwright.config.ts` sets `retries: 0` locally), so a local run cannot produce a
 * flaky outcome at all, and on CI Playwright's own summary already names every flaky
 * test. If cross-lane attribution for flakes is ever wanted, it needs its own wording
 * rather than this block.
 */

import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { PORT_SEAT } from "../../../../scripts/ports.mjs";

import {
  classifyFailure,
  renderContentionReport,
  renderStartNotice,
  snapshotHost,
  type FailureNote,
  type HostSnapshot,
} from "./contention.js";

/** Everything a test result can carry that names what went wrong, as one string. */
export function failureText(result: TestResult): string {
  return [
    ...result.errors.map((error) => `${error.message ?? ""} ${error.stack ?? ""}`),
    result.error?.message ?? "",
    result.error?.stack ?? "",
  ].join("\n");
}

/**
 * A blank snapshot, used when sampling itself failed.
 *
 * The reporter must not be able to fail a run that would otherwise have passed, so every
 * sample is wrapped and a failed one degrades to "unknown" rather than throwing out of a
 * Playwright hook.
 */
const UNKNOWN_SNAPSHOT: HostSnapshot = {
  at: new Date(0).toISOString(),
  load: undefined,
  neighbours: [],
  containers: undefined,
};

function sample(seat: number, snapshot: (seat: number) => HostSnapshot): HostSnapshot {
  try {
    return snapshot(seat);
  } catch {
    return UNKNOWN_SNAPSHOT;
  }
}

/**
 * The seams a unit test replaces.
 *
 * Playwright constructs a reporter with the options object from its config entry, and
 * this one is registered with none, so every field is optional and the defaults are the
 * real thing. A test supplies its own so no `/proc` is read, no `docker` subprocess is
 * spawned, and the report lands in a string instead of the runner's stdout.
 */
export interface ContentionReporterOptions {
  /** Samples the machine. Defaults to the real host probe. */
  readonly snapshotHost?: (seat: number) => HostSnapshot;
  /** Where a rendered block goes. Defaults to the runner's stdout. */
  readonly write?: (text: string) => void;
  /** The seat this run holds. Defaults to the environment's seat. */
  readonly seat?: number;
}

/** A failure held for the end of the run, with the test it came from. */
interface PendingFailure {
  readonly test: TestCase;
  readonly note: FailureNote;
}

export default class ContentionReporter implements Reporter {
  private readonly seat: number;
  private readonly snapshot: (seat: number) => HostSnapshot;
  private readonly write: (text: string) => void;
  private start: HostSnapshot = UNKNOWN_SNAPSHOT;
  /**
   * One entry per test that had a failing attempt, keyed by the test.
   *
   * Keyed rather than appended because a retried test ends more than once, and a report
   * that counted attempts would say "2 failing tests" of one. The last failing attempt
   * wins, which is the one whose text a reader would go looking at.
   */
  private readonly pending = new Map<TestCase, PendingFailure>();

  constructor(options: ContentionReporterOptions = {}) {
    this.seat = options.seat ?? PORT_SEAT;
    this.snapshot = options.snapshotHost ?? snapshotHost;
    this.write =
      options.write ??
      ((text: string) => {
        process.stdout.write(text);
      });
  }

  onBegin(): void {
    this.start = sample(this.seat, this.snapshot);
    if (this.start.neighbours.length === 0) return;
    this.write(`${renderStartNotice(this.seat, this.start.neighbours)}\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "failed" && result.status !== "timedOut") return;
    this.pending.set(test, {
      test,
      note: {
        title: test.titlePath().slice(1).join(" > "),
        signature: classifyFailure(failureText(result)),
      },
    });
  }

  onEnd(): void {
    // A passing run prints nothing here. The start notice already said whether a
    // neighbour was up, and a green run needs no argument about whose green it is:
    // the seat guard makes a run against another worktree impossible, which is the
    // property #255 shipped and this reporter does not restate.
    //
    // "Passing" is the OUTCOME, not the raw status (#828): an expected failure and a
    // retry-recovered flake both leave a failed attempt behind and neither reds the run.
    const failures = [...this.pending.values()]
      .filter((pending) => pending.test.outcome() === "unexpected")
      .map((pending) => pending.note);
    if (failures.length === 0) return;
    this.write(
      `${renderContentionReport({
        seat: this.seat,
        start: this.start,
        end: sample(this.seat, this.snapshot),
        failures,
      })}\n`,
    );
  }

  /**
   * Declare that this reporter writes to stdout.
   *
   * Playwright adds progress output of its own when every configured reporter says it
   * does not print, which would double up on `list`. Saying so here is the honest answer
   * and keeps the run's output exactly as `list` renders it, plus this reporter's blocks.
   */
  printsToStdio(): boolean {
    return true;
  }
}
