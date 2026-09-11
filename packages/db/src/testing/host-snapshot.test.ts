/**
 * The host snapshot, against a fake `docker ps` and a fake `/proc/loadavg` (issue #812).
 *
 * No Docker and no kernel: every probe is injected, which is the point of the seam. What
 * is pinned here is the arithmetic and the wording, because the wording is the deliverable
 * - a reader who gets this line instead of a bare `Connection terminated unexpectedly` has
 * to be able to tell a busy machine from a broken one without running anything.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  formatHostSnapshot,
  hostSnapshotLine,
  HOST_SNAPSHOT_CACHE_MS,
  parseDaemonCensus,
  parseLoadAverage,
  resetHostSnapshotCache,
  sampleHost,
  seatOfProject,
  type HostProbes,
} from "./host-snapshot.js";

afterEach(() => {
  resetHostSnapshotCache();
});

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
    });

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("load 18.42/12.10/9.03 over 8 cpus (2.30 per cpu)");
    expect(line).toContain("docker 7 running, 4 Testcontainers across 3 sessions");
    expect(line).toContain("QCMS stacks seat 3 (qcms-dev-s3), seat 0 (qcms-local-stack)");
    // It reports; it does not conclude.
    expect(line).toContain("not a cause");
  });

  it("names each reading it could not take instead of omitting it", () => {
    const line = formatHostSnapshot({ load: undefined, daemon: undefined });

    expect(line).toContain("load unknown (no /proc/loadavg)");
    expect(line).toContain("docker unknown (the daemon could not be asked)");
  });

  it("says so when the daemon is up and carrying nothing of ours", () => {
    expect(formatHostSnapshot({ load: undefined, daemon: parseDaemonCensus("") })).toContain(
      "no QCMS stacks",
    );
  });
});

/** A probe set that records how often the host was actually read. */
function countingProbes(overrides: Partial<HostProbes> = {}): HostProbes & { calls: () => number } {
  let calls = 0;
  return {
    dockerPs: () => {
      calls += 1;
      return BUSY_DOCKER_PS;
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
    expect(sampleHost(countingProbes({ dockerPs: () => undefined })).daemon).toBeUndefined();
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
