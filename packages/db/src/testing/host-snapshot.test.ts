/**
 * The host snapshot, against a fake `docker ps` and a fake `/proc/loadavg` (issue #812).
 *
 * No Docker and no kernel: every probe is injected, which is the point of the seam. What
 * is pinned here is the arithmetic and the wording, because the wording is the deliverable
 * - a reader who gets this line instead of a bare `Connection terminated unexpectedly` has
 * to be able to tell a busy machine from a broken one without running anything.
 */

import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatHostSnapshot,
  hostSnapshotLine,
  HOST_SNAPSHOT_CACHE_MS,
  HOST_SNAPSHOT_SLOW_CENSUS_CACHE_MS,
  parseDaemonCensus,
  parseLoadAverage,
  resetHostSnapshotCache,
  runDockerCensus,
  sampleHost,
  seatOfProject,
  type DaemonCensusReading,
  type HostProbes,
} from "./host-snapshot.js";

afterEach(() => {
  resetHostSnapshotCache();
});

/** A census that answered, with what it cost. */
function answered(stdout: string, elapsedMs = 120): DaemonCensusReading {
  return { stdout, elapsedMs, timedOut: false };
}

/** A census the daemon did not answer inside its ceiling (issue #942). */
function timedOut(elapsedMs = 3_005): DaemonCensusReading {
  return { stdout: undefined, elapsedMs, timedOut: true };
}

/** A census that could not be taken at all: no Docker CLI on this machine. */
const NO_DOCKER: DaemonCensusReading = { stdout: undefined, elapsedMs: 0, timedOut: false };

/** A busy machine: eleven Testcontainers across four lanes, plus two QCMS dev stacks. */
const BUSY_DOCKER_PS = [
  "objective_bohr\tsession-a\t<no value>",
  "elated_curie\tsession-a\t<no value>",
  "nervous_hawking\tsession-b\t<no value>",
  "wizardly_khayyam\tsession-c\t<no value>",
  "qcms-dev-s3-postgres-1\t<no value>\tqcms-dev-s3",
  "qcms-local-stack-api-1\t<no value>\tqcms-local-stack",
  "someone-elses-redis-1\t<no value>\tsomeone-elses",
].join("\n");

describe("parseLoadAverage", () => {
  it("reads the three averages and keeps the cpu count beside them", () => {
    expect(parseLoadAverage("18.42 12.10 9.03 5/1729 44021\n", 8)).toStrictEqual({
      oneMinute: 18.42,
      fiveMinute: 12.1,
      fifteenMinute: 9.03,
      cpus: 8,
    });
  });

  it("reports a malformed file as unknown rather than as an idle machine", () => {
    // Zero is a real, meaningful load, so a parse failure must never render as one: this
    // line is read by someone deciding whether the host was busy.
    expect(parseLoadAverage("not a loadavg", 8)).toBeUndefined();
    expect(parseLoadAverage("1.0 2.0", 8)).toBeUndefined();
    expect(parseLoadAverage(undefined, 8)).toBeUndefined();
  });
});

describe("seatOfProject", () => {
  it("reads the seat off the Compose project naming convention", () => {
    expect(seatOfProject("qcms-dev")).toBe(0);
    expect(seatOfProject("qcms-dev-s3")).toBe(3);
    expect(seatOfProject("qcms-local-stack")).toBe(0);
    expect(seatOfProject("qcms-local-stack-s9")).toBe(9);
  });

  it("claims no seat for a project this repository does not own", () => {
    expect(seatOfProject("someone-elses")).toBeUndefined();
  });
});

describe("parseDaemonCensus", () => {
  it("counts containers, Testcontainers sessions and this repository's stacks", () => {
    const census = parseDaemonCensus(BUSY_DOCKER_PS);

    expect(census.running).toBe(7);
    expect(census.testcontainers).toBe(4);
    // The number that separates "one suite using several containers" from "four lanes":
    // three of these sessions are not ours whichever one is.
    expect(census.sessions).toBe(3);
    expect(census.stacks).toStrictEqual([
      { project: "qcms-dev-s3", seat: 3 },
      { project: "qcms-local-stack", seat: 0 },
    ]);
  });

  it("reads an idle daemon as empty rather than as unknown", () => {
    expect(parseDaemonCensus("")).toStrictEqual({
      running: 0,
      testcontainers: 0,
      sessions: 0,
      stacks: [],
    });
  });
});

describe("formatHostSnapshot", () => {
  it("says what the machine was doing, on one line", () => {
    const line = formatHostSnapshot({
      load: { oneMinute: 18.42, fiveMinute: 12.1, fifteenMinute: 9.03, cpus: 8 },
      daemon: parseDaemonCensus(BUSY_DOCKER_PS),
      census: answered(BUSY_DOCKER_PS, 212),
    });

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("load 18.42/12.10/9.03 over 8 cpus (2.30 per cpu)");
    expect(line).toContain("docker 7 running, 4 Testcontainers across 3 sessions in 212ms");
    expect(line).toContain("QCMS stacks seat 3 (qcms-dev-s3), seat 0 (qcms-local-stack)");
    // It reports; it does not conclude.
    expect(line).toContain("not a cause");
  });

  it("names each reading it could not take instead of omitting it", () => {
    const line = formatHostSnapshot({ load: undefined, daemon: undefined, census: NO_DOCKER });

    expect(line).toContain("load unknown (no /proc/loadavg)");
    expect(line).toContain("docker unknown (the daemon could not be asked)");
  });

  it("says so when the daemon is up and carrying nothing of ours", () => {
    expect(
      formatHostSnapshot({
        load: undefined,
        daemon: parseDaemonCensus(""),
        census: answered(""),
      }),
    ).toContain("no QCMS stacks");
  });

  it("reports a census that ran out of time as a reading, not as an absence", () => {
    // Issue #942. "The daemon did not answer in three seconds" and "there is no Docker on
    // this machine" are opposite facts about a host, and they used to render identically.
    // The first one is the very condition this line exists to report.
    const line = formatHostSnapshot({
      load: { oneMinute: 101.2, fiveMinute: 98.4, fifteenMinute: 71.9, cpus: 24 },
      daemon: undefined,
      census: timedOut(3_005),
    });

    expect(line).toContain("docker unknown (the daemon did not answer the census within 3005ms)");
    expect(line).not.toContain("could not be asked");
    // Partial, not empty: the half that was readable is still there, on one line.
    expect(line).toContain("load 101.20/98.40/71.90 over 24 cpus (4.22 per cpu)");
    expect(line.split("\n")).toHaveLength(1);
  });
});

/** A probe set that records how often the host was actually read. */
function countingProbes(overrides: Partial<HostProbes> = {}): HostProbes & { calls: () => number } {
  let calls = 0;
  return {
    dockerPs: () => {
      calls += 1;
      return answered(BUSY_DOCKER_PS);
    },
    loadavg: () => "1.00 1.00 1.00 1/1 1",
    cpus: () => 4,
    calls: () => calls,
    ...overrides,
  };
}

describe("sampleHost", () => {
  it("builds the snapshot from the two injected readings", () => {
    const snapshot = sampleHost(countingProbes());

    expect(snapshot.load?.cpus).toBe(4);
    expect(snapshot.daemon?.testcontainers).toBe(4);
  });

  it("reports an unaskable daemon as unknown rather than as empty", () => {
    // "docker could not be asked" and "docker is running nothing" must not collapse into
    // one rendering: the second would read as an idle machine.
    expect(sampleHost(countingProbes({ dockerPs: () => NO_DOCKER })).daemon).toBeUndefined();
  });

  it("keeps the census reading beside the census, so a timeout survives into the line", () => {
    const snapshot = sampleHost(countingProbes({ dockerPs: () => timedOut(3_012) }));

    expect(snapshot.daemon).toBeUndefined();
    expect(snapshot.census).toStrictEqual({ stdout: undefined, elapsedMs: 3_012, timedOut: true });
    // The other half of the snapshot is untouched by the daemon's trouble.
    expect(snapshot.load?.cpus).toBe(4);
  });
});

describe("hostSnapshotLine", () => {
  it("reads the host once per cache window, however many failures ask", () => {
    // A pool whose backend vanished rejects every query in flight. Spawning a `docker ps`
    // per rejection would make the diagnostic a load source on the machine it measures.
    const probes = countingProbes();

    const first = hostSnapshotLine(probes, 1_000);
    const second = hostSnapshotLine(probes, 1_000 + HOST_SNAPSHOT_CACHE_MS - 1);

    expect(second).toBe(first);
    expect(probes.calls()).toBe(1);
  });

  it("takes a fresh reading once the window has passed", () => {
    const probes = countingProbes();

    hostSnapshotLine(probes, 1_000);
    hostSnapshotLine(probes, 1_000 + HOST_SNAPSHOT_CACHE_MS);

    expect(probes.calls()).toBe(2);
  });

  it("reuses a timed-out census for longer than a cheap one", () => {
    // Issue #942. A census that hit its ceiling cost the whole ceiling, and re-paying that
    // every five seconds through a cascade of failures is how a diagnostic starts spending
    // the budget of the run it is diagnosing.
    // Counted here rather than through `countingProbes`, whose counter belongs to the
    // reading it hands back and would be replaced along with it.
    let calls = 0;
    const probes = countingProbes({
      dockerPs: () => {
        calls += 1;
        return timedOut();
      },
    });

    hostSnapshotLine(probes, 1_000);
    hostSnapshotLine(probes, 1_000 + HOST_SNAPSHOT_CACHE_MS);
    expect(calls).toBe(1);

    hostSnapshotLine(probes, 1_000 + HOST_SNAPSHOT_SLOW_CENSUS_CACHE_MS);
    expect(calls).toBe(2);
  });

  it("degrades to unknown rather than throwing out of an error path", () => {
    // It only ever runs while something else is already failing. An exception here would
    // replace the failure a reader needs with one about the diagnostic.
    const line = hostSnapshotLine(
      countingProbes({
        dockerPs: () => {
          throw new Error("docker exploded");
        },
      }),
      2_000,
    );

    expect(line).toContain("docker unknown");
  });
});

/**
 * The degrade path against a command that is slow on purpose (issue #942).
 *
 * The condition this file is about - a Docker daemon too busy to answer `docker ps` in
 * three seconds - was reproducible only on a host at load 100 with 54 Testcontainers
 * Postgres up, and a test that produced that condition would be a test that caused it. So
 * the daemon is stood in for by a command whose whole job is to outlive its ceiling: what
 * is pinned is that `runDockerCensus` reports an overrun as an overrun rather than as a
 * silence, which is the decision the rendering hangs off.
 */
describe("runDockerCensus", () => {
  /** `sleep` and `echo` as absolute paths: the same rule the Docker probe follows. */
  const slowCommand = ["/bin/sleep", "/usr/bin/sleep"].find((path) => existsSync(path)) ?? "";
  const fastCommand = ["/bin/echo", "/usr/bin/echo"].find((path) => existsSync(path)) ?? "";

  it.skipIf(slowCommand === "")("reports a census that outran its ceiling", () => {
    // A small ceiling rather than the real 3 s one: what is under test is the reporting,
    // and the test should not spend the budget it exists to protect.
    const reading = runDockerCensus(slowCommand, ["5"], 200);

    expect(reading.timedOut).toBe(true);
    expect(reading.stdout).toBeUndefined();
    expect(reading.elapsedMs).toBeGreaterThanOrEqual(200);
    // It gave up at the ceiling rather than waiting out the command.
    expect(reading.elapsedMs).toBeLessThan(5_000);
  });

  it.skipIf(fastCommand === "")("returns the output and the cost when it answers", () => {
    const reading = runDockerCensus(fastCommand, ["ok"], 5_000);

    expect(reading.stdout?.trim()).toBe("ok");
    expect(reading.timedOut).toBe(false);
    expect(reading.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a command that is not there as unaskable, not as a timeout", () => {
    // The distinction the rendering depends on: no Docker is not a busy Docker.
    const reading = runDockerCensus("/nonexistent/qcms-census-probe", [], 5_000);

    expect(reading.stdout).toBeUndefined();
    expect(reading.timedOut).toBe(false);
  });
});
