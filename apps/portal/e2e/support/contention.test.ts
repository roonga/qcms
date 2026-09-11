import { describe, expect, it } from "vitest";

import {
  CONTENTION_SIGNATURES,
  classifyFailure,
  describeNeighbours,
  mergeNeighbours,
  neighbourStacks,
  otherSeats,
  renderContentionReport,
  renderStartNotice,
  type HostSnapshot,
  type NeighbourStack,
} from "./contention.js";
import { hostPressure, type ContainerCensus } from "./host-pressure.js";

/**
 * What the contention report is allowed to claim (issue #395).
 *
 * The report exists because a red browser gate could be entirely caused by a neighbouring
 * lane while presenting as the branch's own regression. Everything below is about keeping
 * the cure smaller than the disease: the report must never say a run was alone when it was
 * not, must never say it was crowded when it was not, and must never - in any branch - be
 * readable as permission to ignore a failure. A diagnostic that can be misread as a pass
 * is a worse gate than one that says nothing at all.
 *
 * The impure halves (`/proc`, `docker ps`) are covered by parsing their real output shapes
 * rather than by mocking a daemon: the sampling functions are three lines each around a
 * parse, and the parse is where the mistakes are.
 */

/** A neighbour on a given seat, with the fields the report actually prints. */
function stack(seat: number, port: number, pid?: number): NeighbourStack {
  return { seat, service: "admin", port, pid, cwd: pid === undefined ? undefined : "/w/other" };
}

const EMPTY: HostSnapshot = {
  at: "1970-01-01T00:00:00.000Z",
  load: undefined,
  neighbours: [],
  containers: undefined,
};

/**
 * Waves 11 to 13, as the daemon and the kernel saw them: eleven Testcontainers across four
 * sessions and a run queue at more than twice the CPU count, with not one seat port taken
 * because the other lanes were running `turbo run test` rather than a browser suite.
 */
const CROWDED_DAEMON: ContainerCensus = {
  running: 14,
  testcontainers: 11,
  sessions: 4,
  qcmsStacks: 1,
};

const CROWDED: HostSnapshot = {
  at: "1970-01-01T00:00:00.000Z",
  load: { oneMinute: 18.42, fiveMinute: 12.1, fifteenMinute: 9.03, cpus: 8 },
  neighbours: [],
  containers: CROWDED_DAEMON,
};

describe("otherSeats", () => {
  it("covers every seat except this run's own", () => {
    expect(otherSeats(1)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(otherSeats(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("neighbourStacks", () => {
  it("never reports this run's own ports as a neighbour", () => {
    // Every port occupied, including seat 1's own. The run's own servers are the whole
    // reason its ports are busy, and reporting them would make the notice fire on every
    // single run, which is how a warning stops being read.
    const found = neighbourStacks(1, () => ({ pid: 42, cwd: "/w" }));
    expect(found.every((entry) => entry.seat !== 1)).toBe(true);
    expect(found.map((entry) => entry.port).some((port) => port >= 17100 && port < 17200)).toBe(
      false,
    );
  });

  it("names the seat, service and occupant of a live neighbouring stack", () => {
    const found = neighbourStacks(1, (port) =>
      port === 17340 ? { pid: 4242, cwd: "/w/other" } : undefined,
    );
    expect(found).toEqual([{ seat: 3, service: "admin", port: 17340, pid: 4242, cwd: "/w/other" }]);
  });

  it("reports a quiet machine as quiet", () => {
    expect(neighbourStacks(1, () => undefined)).toEqual([]);
  });
});

describe("describeNeighbours", () => {
  it("groups a seat's ports onto one line", () => {
    expect(describeNeighbours([stack(3, 17300, 11), stack(3, 17340, 12)])).toEqual([
      "  - seat 3: admin 17300 (pid 11, cwd /w/other), admin 17340 (pid 12, cwd /w/other)",
    ]);
  });

  it("still names a seat whose occupant could not be attributed", () => {
    // `/proc` can refuse to name another user's process. "Somebody is on seat 5" is the
    // load-bearing half; the pid is the convenience.
    expect(describeNeighbours([stack(5, 17540)])).toEqual(["  - seat 5: admin 17540"]);
  });

  it("says when a neighbour only appeared at one end of the run", () => {
    // The asymmetry is the interesting part: one that arrived partway through is a
    // different story from one that was there all along.
    const merged = mergeNeighbours([stack(3, 17340, 11)], [stack(7, 17740, 12)]);
    expect(describeNeighbours(merged)).toEqual([
      "  - seat 3: admin 17340 (pid 11, cwd /w/other) [gone by the end of the run]",
      "  - seat 7: admin 17740 (pid 12, cwd /w/other) [arrived during the run]",
    ]);
  });

  it("leaves a neighbour present throughout untagged", () => {
    const merged = mergeNeighbours([stack(3, 17340, 11)], [stack(3, 17340, 11)]);
    expect(describeNeighbours(merged)).toEqual(["  - seat 3: admin 17340 (pid 11, cwd /w/other)"]);
  });
});

describe("mergeNeighbours", () => {
  it("is the union of both samples, not either one of them", () => {
    const merged = mergeNeighbours([stack(3, 17340, 11)], [stack(7, 17740, 12)]);
    expect(merged.map((entry) => [entry.seat, entry.seenAt])).toEqual([
      [3, "start"],
      [7, "end"],
    ]);
  });

  it("counts a port seen in both samples once", () => {
    expect(mergeNeighbours([stack(3, 17340, 11)], [stack(3, 17340, 11)])).toEqual([
      { ...stack(3, 17340, 11), seenAt: "both" },
    ]);
  });

  it("orders by seat and then by port, so the report reads the same way twice", () => {
    const merged = mergeNeighbours([stack(7, 17740, 1), stack(3, 17340, 2)], [stack(3, 17300, 3)]);
    expect(merged.map((entry) => entry.port)).toEqual([17300, 17340, 17740]);
  });
});

describe("classifyFailure", () => {
  it("recognises the shapes a starved dependency produces", () => {
    expect(classifyFailure("connect ECONNREFUSED 127.0.0.1:17110")).toBe("connection refused");
    expect(classifyFailure("Error: socket hang up")).toBe("connection dropped");
    expect(classifyFailure("Timed out waiting 180000ms from config.webServer.")).toBe(
      "boot timeout",
    );
    expect(classifyFailure("Could not find a valid Docker environment")).toBe("container startup");
    expect(classifyFailure("page.goto: net::ERR_CONNECTION_REFUSED")).toBe("connection refused");
  });

  it("recognises a concurrent build pulled out from under a running dev server", () => {
    // Taken verbatim from a real red: a forced turbo run in the same tree rewrote every
    // package's `dist/`, and the portal dev server answered this for the seconds the
    // directory was missing. The server-log gate then failed a spec that touched nothing.
    expect(
      classifyFailure(
        "[portal] Error: Module not found: Can't resolve '@roonga/qcms-ui/fonts'\n" +
          "at ./apps/portal/lib/server/theme.ts:33:1",
      ),
    ).toBe("workspace rebuild");
  });

  it("leaves an ordinary assertion failure unlabelled", () => {
    // The annotation's whole value is that it is selective. A classifier that matched a
    // plain expectation failure would put a contention note under every red run, and a
    // note that always appears is a note nobody reads.
    expect(
      classifyFailure('expect(received).toHaveText(expected)\nExpected: "Saved"\nReceived: "Save"'),
    ).toBeUndefined();
    expect(classifyFailure("axe found 1 violation: color-contrast")).toBeUndefined();
  });

  it("has a reason written down for every signature it carries", () => {
    for (const signature of CONTENTION_SIGNATURES) {
      expect(signature.why.length, `${signature.name} needs a reason`).toBeGreaterThan(10);
    }
  });
});

describe("renderStartNotice", () => {
  it("names the neighbouring seats and says what is not partitioned", () => {
    const notice = renderStartNotice(1, [stack(3, 17340, 9), stack(7, 17740, 10)]);
    expect(notice).toContain("seat 1 is NOT alone");
    expect(notice).toContain("seats 3, 7");
    expect(notice).toContain("Docker daemon and the CPU are not");
  });

  it("still warns when the machine is busy and no other seat is taken", () => {
    // The warning is worth more at the start than at the end: fifteen minutes before the
    // red, waiting is still a choice the reader can make.
    const notice = renderStartNotice(1, [], hostPressure(CROWDED.load, CROWDED.containers).reasons);

    expect(notice).toContain("seat 1 holds its own ports, but this machine is NOT quiet");
    expect(notice).toContain("Testcontainers sessions on the shared daemon");
  });
});

describe("renderContentionReport", () => {
  const failing = [
    { title: "admin auth > signs in", signature: "connection refused" },
    { title: "admin auth > signs out", signature: undefined },
  ];

  it("says plainly that a quiet machine gives the run no excuse", () => {
    const report = renderContentionReport({
      seat: 1,
      start: EMPTY,
      end: EMPTY,
      failures: [{ title: "a test", signature: undefined }],
    });
    expect(report).toContain("none occupied");
    expect(report).toContain("this branch's own");
    expect(report).not.toContain("was not alone");
  });

  it("lists every neighbour the header counts, including one that only arrived later", () => {
    // The defect this pins: the header counted the union of both samples while the detail
    // lines rendered the start sample, so a lane that arrived mid-run - while another was
    // already there - was counted above and missing below. A report about who else was on
    // the machine has to agree with itself, or it is worse than no report.
    const report = renderContentionReport({
      seat: 1,
      start: { ...EMPTY, neighbours: [stack(3, 17340, 9)] },
      end: { ...EMPTY, neighbours: [stack(3, 17340, 9), stack(7, 17740, 10)] },
      failures: failing,
    });
    expect(report).toContain("OCCUPIED on seats 3, 7");
    expect(report).toContain("  - seat 3: admin 17340 (pid 9, cwd /w/other)");
    expect(report).toContain(
      "  - seat 7: admin 17740 (pid 10, cwd /w/other) [arrived during the run]",
    );
  });

  it("names the neighbour and the contention-shaped failures when there was one", () => {
    const busy: HostSnapshot = { ...EMPTY, neighbours: [stack(3, 17340, 9)] };
    const report = renderContentionReport({ seat: 1, start: busy, end: busy, failures: failing });
    expect(report).toContain("OCCUPIED on seat 3");
    expect(report).toContain("1 of 2 failures match a resource-contention shape");
    expect(report).toContain("admin auth > signs in: connection refused");
    expect(report).toContain("This run was not alone");
  });

  it("never suggests the run passed, in either branch", () => {
    // The one property this whole feature must not break. It annotates a red; it does
    // not soften one, and no phrasing here may read as permission to merge on it.
    const busy: HostSnapshot = { ...EMPTY, neighbours: [stack(3, 17340, 9)] };
    for (const snapshot of [EMPTY, busy]) {
      const report = renderContentionReport({
        seat: 1,
        start: snapshot,
        end: snapshot,
        failures: failing,
      });
      expect(report).toMatch(/2 failing tests/);
      expect(report.toLowerCase()).not.toContain("ignore");
      expect(report.toLowerCase()).not.toContain("safe to");
    }
    expect(
      renderContentionReport({ seat: 1, start: busy, end: busy, failures: failing }),
    ).toContain("the run still failed");
  });

  it("carries the load and container figures a reader would otherwise have to guess", () => {
    const snapshot: HostSnapshot = {
      at: "1970-01-01T00:00:00.000Z",
      load: { oneMinute: 12, fiveMinute: 8, fifteenMinute: 4, cpus: 24 },
      neighbours: [],
      containers: { running: 9, testcontainers: 2, sessions: 1, qcmsStacks: 6 },
    };
    const report = renderContentionReport({
      seat: 1,
      start: snapshot,
      end: EMPTY,
      failures: failing,
    });
    expect(report).toContain("12.00 / 8.00 / 4.00 over 24 cpus (1m load is 0.50 per cpu)");
    expect(report).toContain(
      "9 running, of which 2 Testcontainers across 1 session and 6 QCMS Compose",
    );
    expect(report).toContain("unknown (no /proc/loadavg)");
    expect(report).toContain("unknown (docker could not be asked)");
  });

  it("says the machine was busy even when no neighbour held a seat port", () => {
    // Issue #395's second occurrence, which the first version of this report got wrong.
    // The competing lanes were running `turbo run test`: no browser harness, no seat
    // ports, nothing for `neighbourStacks` to find, and eleven Postgres containers from
    // other sessions on the one daemon. The report used to answer that with "nothing here
    // argues against reading these failures as this branch's own".
    const report = renderContentionReport({
      seat: 1,
      start: CROWDED,
      end: CROWDED,
      failures: failing,
    });

    expect(report).toContain("none occupied");
    expect(report).toContain("THE MACHINE WAS NOT QUIET");
    expect(report).toContain(
      "  - throughout: 4 Testcontainers sessions on the shared daemon (3 of them not this run's)",
    );
    expect(report).toContain("1m load 18.42 over 8 cpus (2.30 per cpu");
    expect(report).toContain("This run was not alone");
    // And the sentence that was wrong here is gone from this branch.
    expect(report).not.toContain("nothing here argues against");
    expect(report).not.toContain("Treat these failures as this branch's own");
  });

  it("still says a quiet machine is quiet, which is the only time that was ever true", () => {
    const quiet: HostSnapshot = {
      ...EMPTY,
      load: { oneMinute: 1.5, fiveMinute: 1, fifteenMinute: 1, cpus: 8 },
      containers: { running: 3, testcontainers: 2, sessions: 1, qcmsStacks: 1 },
    };

    const report = renderContentionReport({ seat: 1, start: quiet, end: quiet, failures: failing });

    // One session is this run's own and 1.5 over 8 cpus is a working machine, not a
    // crowded one. A threshold that fired here would fire on every healthy run.
    expect(report).not.toContain("NOT QUIET");
    expect(report).toContain("the host looked quiet");
  });

  it("adds the host pressure underneath a neighbour it already named", () => {
    const report = renderContentionReport({
      seat: 1,
      start: { ...CROWDED, neighbours: [stack(3, 17340, 9)] },
      end: { ...CROWDED, neighbours: [stack(3, 17340, 9)] },
      failures: failing,
    });

    expect(report).toContain("OCCUPIED on seat 3");
    expect(report).toContain("and the host itself was under pressure:");
    expect(report).toContain("Testcontainers sessions on the shared daemon");
  });

  it("does not print the same unchanged reading twice, and does print a changed one", () => {
    const busier: HostSnapshot = {
      ...CROWDED,
      containers: { ...CROWDED_DAEMON, sessions: 6 },
    };

    const unchanged = renderContentionReport({
      seat: 1,
      start: CROWDED,
      end: CROWDED,
      failures: failing,
    });
    const changed = renderContentionReport({
      seat: 1,
      start: CROWDED,
      end: busier,
      failures: failing,
    });

    expect(unchanged.split("Testcontainers sessions on the shared daemon")).toHaveLength(2);
    expect(unchanged).toContain("throughout: 4 Testcontainers sessions");
    expect(changed).toContain("at start: 4 Testcontainers sessions");
    expect(changed).toContain("at end: 6 Testcontainers sessions");
  });
});
