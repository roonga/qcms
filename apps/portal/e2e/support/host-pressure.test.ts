import { describe, expect, it } from "vitest";

import {
  LOAD_PRESSURE_PER_CPU,
  describeContainers,
  describeLoad,
  foreignSessions,
  hostPressure,
  parseContainerCensus,
  parseLoadAverage,
  renderHostLine,
  type ContainerCensus,
} from "./host-pressure.js";

/**
 * What the machine probe is allowed to claim (issues #395 and #812).
 *
 * The two parsers were pinned here before the pressure rule existed and their cases move
 * with them: `/proc` and `docker ps` are three lines each around a parse, and the parse is
 * where the mistakes are. What is new is the rule built on top - the one that decides
 * whether a run gets told the machine was busy. It has to be wrong in the safe direction
 * in both directions at once: a threshold that fires on a healthy suite teaches readers to
 * skip the block, and one that never fires leaves #395's second occurrence unreported.
 */

/** Waves 11 to 13: eleven Testcontainers across four lanes, and no seat port taken. */
const CROWDED: ContainerCensus = { running: 14, testcontainers: 11, sessions: 4, qcmsStacks: 1 };

/** One lane, mid-suite: its own Postgres and its own reaper, one session. */
const OURS_ALONE: ContainerCensus = { running: 2, testcontainers: 2, sessions: 1, qcmsStacks: 0 };

describe("parseLoadAverage", () => {
  it("reads the three averages the kernel writes", () => {
    expect(parseLoadAverage("6.65 8.19 5.60 1/1847 165281\n", 24)).toEqual({
      oneMinute: 6.65,
      fiveMinute: 8.19,
      fifteenMinute: 5.6,
      cpus: 24,
    });
  });

  it("reports unknown rather than zero when the file is not what it expects", () => {
    // Zero is a real load figure. A parse failure rendered as one would read as "the
    // machine was idle" in the very report someone is using to decide whether it was.
    expect(parseLoadAverage("", 8)).toBeUndefined();
    expect(parseLoadAverage("not a load average at all", 8)).toBeUndefined();
    expect(parseLoadAverage("1.0 2.0", 8)).toBeUndefined();
  });
});

describe("parseContainerCensus", () => {
  it("counts running containers, Testcontainers among them, and QCMS stacks", () => {
    const census = parseContainerCensus(
      [
        "qcms-local-stack-api-1\t",
        "qcms-dev-s1-postgres-1\t",
        "relaxed_bell\t9f2c1c4e-0000-4000-8000-000000000001",
        "sig-pilot-db-1\t",
      ].join("\n"),
    );
    expect(census).toEqual({ running: 4, testcontainers: 1, sessions: 1, qcmsStacks: 2 });
  });

  it("counts the SESSIONS those containers belong to, not just the containers", () => {
    // The number that sees a lane holding no seat port. Three containers can be one suite
    // using three, or three lanes using one each, and only the second is a neighbour.
    const census = parseContainerCensus(
      [
        "relaxed_bell\tsession-a",
        "objective_bohr\tsession-a",
        "elated_curie\tsession-b",
        "nervous_hawking\tsession-c",
      ].join("\n"),
    );
    expect(census.testcontainers).toBe(4);
    expect(census.sessions).toBe(3);
  });

  it("treats Docker's empty-label placeholder as no label", () => {
    // `docker ps` prints `<no value>` for a label a container does not carry, and a
    // census that counted that string would report every container as Testcontainers.
    expect(parseContainerCensus("some_container\t<no value>\n")).toEqual({
      running: 1,
      testcontainers: 0,
      sessions: 0,
      qcmsStacks: 0,
    });
  });

  it("reads an empty daemon as empty rather than as one blank container", () => {
    const empty = { running: 0, testcontainers: 0, sessions: 0, qcmsStacks: 0 };
    expect(parseContainerCensus("")).toEqual(empty);
    expect(parseContainerCensus("\n\n")).toEqual(empty);
  });
});

describe("foreignSessions", () => {
  it("never counts this run's own session as a neighbour", () => {
    expect(foreignSessions(OURS_ALONE)).toBe(0);
    expect(foreignSessions(CROWDED)).toBe(3);
  });

  it("claims no neighbour when the daemon could not be asked", () => {
    expect(foreignSessions(undefined)).toBe(0);
  });
});

describe("hostPressure", () => {
  it("reports another lane's Testcontainers session, which holds no seat port", () => {
    const { reasons } = hostPressure(undefined, CROWDED);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("4 Testcontainers sessions on the shared daemon");
    expect(reasons[0]).toContain("3 of them not this run's");
    expect(reasons[0]).toContain("11 containers between them");
  });

  it("reports a run queue at or past the threshold, with the ratio spelled out", () => {
    const { reasons } = hostPressure(
      { oneMinute: 18.42, fiveMinute: 12.1, fifteenMinute: 9.03, cpus: 8 },
      OURS_ALONE,
    );

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("1m load 18.42 over 8 cpus (2.30 per cpu");
  });

  it("says nothing about a machine that is merely working", () => {
    // A passing browser suite runs two dev servers, an API and a Postgres container and
    // sits around one per cpu. A rule that fired here would fire on every healthy run,
    // and a block that appears on healthy runs is a block readers learn to skip.
    expect(
      hostPressure({ oneMinute: 8, fiveMinute: 6, fifteenMinute: 4, cpus: 8 }, OURS_ALONE).reasons,
    ).toHaveLength(0);
  });

  it("fires exactly at the threshold rather than just past it", () => {
    const cpus = 8;
    const oneMinute = cpus * LOAD_PRESSURE_PER_CPU;

    expect(
      hostPressure({ oneMinute, fiveMinute: 1, fifteenMinute: 1, cpus }, undefined).reasons,
    ).toHaveLength(1);
  });

  it("claims nothing at all when neither reading could be taken", () => {
    // "Could not measure" and "measured, and it was quiet" must not collapse: the second
    // is an argument about a red and the first is not.
    expect(hostPressure(undefined, undefined).reasons).toHaveLength(0);
  });
});

describe("renderHostLine", () => {
  it("puts both readings on one line, for a message that has room for one", () => {
    const line = renderHostLine(
      { oneMinute: 18.42, fiveMinute: 12.1, fifteenMinute: 9.03, cpus: 8 },
      CROWDED,
    );

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("18.42 / 12.10 / 9.03 over 8 cpus");
    expect(line).toContain("14 running, of which 11 Testcontainers across 4 sessions");
  });

  it("names a reading it could not take instead of omitting it", () => {
    expect(describeLoad(undefined)).toContain("no /proc/loadavg");
    expect(describeContainers(undefined)).toContain("docker could not be asked");
  });
});
