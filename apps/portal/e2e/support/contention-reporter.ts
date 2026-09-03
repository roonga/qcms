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

function sample(seat: number): HostSnapshot {
  try {
    return snapshotHost(seat);
  } catch {
    return UNKNOWN_SNAPSHOT;
  }
}

export default class ContentionReporter implements Reporter {
  private readonly seat = PORT_SEAT;
  private start: HostSnapshot = UNKNOWN_SNAPSHOT;
  private readonly failures: FailureNote[] = [];

  onBegin(): void {
    this.start = sample(this.seat);
    if (this.start.neighbours.length === 0) return;
    process.stdout.write(`${renderStartNotice(this.seat, this.start.neighbours)}\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "failed" && result.status !== "timedOut") return;
    this.failures.push({
      title: test.titlePath().slice(1).join(" > "),
      signature: classifyFailure(failureText(result)),
    });
  }

  onEnd(): void {
    // A passing run prints nothing here. The start notice already said whether a
    // neighbour was up, and a green run needs no argument about whose green it is:
    // the seat guard makes a run against another worktree impossible, which is the
    // property #255 shipped and this reporter does not restate.
    if (this.failures.length === 0) return;
    process.stdout.write(
      `${renderContentionReport({
        seat: this.seat,
        start: this.start,
        end: sample(this.seat),
        failures: this.failures,
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
