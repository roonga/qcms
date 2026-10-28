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
import { hostPressure } from "./host-pressure.js";

/** Everything a test result can carry that names what went wrong, as one string. */
export function failureText(result: TestResult): string {
  return [
    ...result.errors.map((error) => `${error.message ?? ""} ${error.stack ?? ""}`),
    result.error?.message ?? "",
    result.error?.stack ?? "",
  ].join("\n");
}

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

export interface ContentionReporterOptions {
  /** Samples the machine. Defaults to the real host probe. */
  readonly snapshotHost?: (seat: number) => HostSnapshot;
  /** Where a rendered block goes. Defaults to the runner's stdout. */
  readonly write?: (text: string) => void;
  /** The seat this run holds. Defaults to the environment's seat. */
  readonly seat?: number;
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
  private readonly pending = new Map<TestCase, FailureNote>();

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
    const pressure = hostPressure(this.start.load, this.start.containers).reasons;
    if (this.start.neighbours.length === 0 && pressure.length === 0) return;
    this.write(`${renderStartNotice(this.seat, this.start.neighbours, pressure)}\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "failed" && result.status !== "timedOut") return;
    this.pending.set(test, {
      title: test.titlePath().slice(1).join(" > "),
      signature: classifyFailure(failureText(result)),
    });
  }

  onEnd(): void {
    const failures = [...this.pending]
      .filter(([test]) => test.outcome() === "unexpected")
      .map(([, note]) => note);
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
