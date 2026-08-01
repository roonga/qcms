import { readlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { API_PORT, OTLP_PORT, PORTAL_PORT } from "./harness-config.js";
import {
  DEFAULT_PORT_SEAT,
  HARNESS_REPO_ROOT,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  PORT_SEAT,
  PORT_SEAT_ENV_VAR,
  type SeatPortOccupant,
  assertSeatPortsOutsideEphemeralRange,
  assertSeatPortsUsable,
  composeProjectName,
  ephemeralPortRange,
  harnessPort,
  harnessPorts,
  isAdoptable,
  occupantOfPort,
  resolvePortSeat,
  stablePort,
} from "./port-seat.js";

/**
 * The port seat (issue #255).
 *
 * What this suite guards, stated plainly, because most of it is arithmetic and only
 * one part is the actual defect:
 *
 *  1. **Seat 0 is today's allocation, byte for byte.** That is the compatibility
 *     contract for the whole change: an existing developer and CI set nothing and
 *     notice nothing on the human-facing block.
 *  2. **The arithmetic**, so `7S00/7S10/7S20/7S30` and `17S00/17S10/17S30/17S40` are
 *     what a seat binds, every one is a legal TCP port (which `7xxxx` would not have
 *     been), and an out-of-range seat is an error rather than a nonsense port.
 *  3. **The ephemeral-range assertion**, which is what stops a block being chosen
 *     inside the kernel's auto-assign window and turning into an unreproducible bind
 *     flake.
 *  4. **The occupancy refusal**, which is the defect itself. Before this, a lane
 *     starting a browser run while another lane's dev servers were up reused those
 *     servers silently and reported green for a worktree it never loaded. Ports now
 *     differ per seat, so that cannot happen between seats; the refusal is the
 *     backstop, and it has to actually see a listener and actually attribute it to a
 *     process, or it is decoration. The `occupantOfPort` test below binds a real
 *     socket and asserts the `/proc` walk finds THIS process and its cwd, which is
 *     the same read that caught the original collision by hand.
 *
 * ## This file is also the turbo-passthrough witness
 *
 * `harness-config.ts` resolves its ports from `QCMS_PORT_SEAT` at module load and
 * throws on a bad value, so importing it here means an invalid seat fails the portal
 * project. That is how to prove the variable survives turbo's strict env mode
 * (CLAUDE.md's standing trap): `QCMS_PORT_SEAT=99 pnpm exec turbo run test --filter
 * qcms-portal --force` must FAIL. If it passes, the variable is being stripped and
 * `turbo.json`'s `globalPassThroughEnv` has lost its entry.
 */

/** Sockets opened by a test, closed even if an expectation throws. */
const opened: Server[] = [];

/** Close one listener and wait for the port to be released. */
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(close));
});

/**
 * Listen on a kernel-assigned port, so this test can never collide with a real seat
 * (including a second seat running this same suite at the same time).
 */
async function listenOnFreePort(): Promise<{ port: number; server: Server }> {
  const server = createServer();
  opened.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port assigned");
  return { port: address.port, server };
}

/** A synthetic occupant, for the parts of the refusal that need no real socket. */
function occupant(overrides: Partial<SeatPortOccupant> = {}): SeatPortOccupant {
  return { service: "portal", port: 17_000, pid: 4242, cwd: "/elsewhere/qcms", ...overrides };
}

describe("seat 0 is today's allocation", () => {
  it("puts the human-facing services exactly where they already are", () => {
    // The compatibility contract. If this ever changes, every developer's bookmark,
    // every doc URL and the devcontainer's `appPort` are wrong at the same moment.
    expect(stablePort("portal", 0)).toBe(7000);
    expect(stablePort("api", 0)).toBe(7010);
    expect(stablePort("postgres", 0)).toBe(7020);
    expect(stablePort("artifacts", 0)).toBe(7030);
  });

  it("is what an unset environment resolves to", () => {
    expect(resolvePortSeat(undefined)).toBe(DEFAULT_PORT_SEAT);
    expect(DEFAULT_PORT_SEAT).toBe(0);
  });

  it("leaves the Compose project name alone, so no existing database moves", () => {
    // Two Compose stacks with one project name ARE one stack, so this is the seam
    // that decides whether a second seat gets its own database or silently shares.
    expect(composeProjectName(0)).toBe("qcms-dev");
    expect(composeProjectName(1)).toBe("qcms-dev-s1");
  });
});

describe("resolvePortSeat", () => {
  it("defaults when unset or empty", () => {
    expect(resolvePortSeat("")).toBe(DEFAULT_PORT_SEAT);
    expect(resolvePortSeat("  ")).toBe(DEFAULT_PORT_SEAT);
  });

  it("accepts every seat in range, trimming whitespace", () => {
    expect(resolvePortSeat("0")).toBe(MIN_PORT_SEAT);
    expect(resolvePortSeat(" 2 ")).toBe(2);
    expect(resolvePortSeat("9")).toBe(MAX_PORT_SEAT);
  });

  it.each(["10", "-1", "1.5", "a", "01", "2x", "99"])(
    "refuses %s loudly rather than coercing it",
    (raw) => {
      // Coercing would be the dangerous outcome: a bad value that fell back to seat 0
      // would put this run straight back on another seat's ports, silently.
      expect(() => resolvePortSeat(raw)).toThrow(PORT_SEAT_ENV_VAR);
      expect(() => resolvePortSeat(raw)).toThrow("docs/PORTS.md");
    },
  );
});

describe("port arithmetic", () => {
  it("lays each seat's harness block out as 17S00 / 17S10 / 17S30 / 17S40", () => {
    expect(harnessPorts(0).map((entry) => entry.port)).toEqual([17_000, 17_010, 17_030, 17_040]);
    expect(harnessPorts(1).map((entry) => entry.port)).toEqual([17_100, 17_110, 17_130, 17_140]);
    expect(harnessPorts(9).map((entry) => entry.port)).toEqual([17_900, 17_910, 17_930, 17_940]);
  });

  it("lays each seat's stable block out as 7S00 / 7S10 / 7S20 / 7S30", () => {
    expect(stablePort("portal", 1)).toBe(7100);
    expect(stablePort("api", 1)).toBe(7110);
    expect(stablePort("postgres", 1)).toBe(7120);
    expect(stablePort("artifacts", 1)).toBe(7130);
  });

  it("keeps every port legal, which a 7xxxx harness block would not have been", () => {
    // The trap in "five digits, keep the 7": 70000 and up are above the maximum TCP
    // port and simply cannot bind. 17xxx keeps the mnemonic and stays legal.
    for (let seat = MIN_PORT_SEAT; seat <= MAX_PORT_SEAT; seat += 1) {
      for (const { port } of harnessPorts(seat)) {
        expect(port).toBeGreaterThan(1023);
        expect(port).toBeLessThanOrEqual(65_535);
      }
      expect(stablePort("portal", seat)).toBeLessThanOrEqual(65_535);
    }
  });

  it("refuses a seat outside 0-9", () => {
    expect(() => harnessPort("portal", -1)).toThrow("out of range");
    expect(() => harnessPort("portal", 10)).toThrow("out of range");
    expect(() => stablePort("portal", 10)).toThrow("out of range");
  });

  it("is what harness-config actually publishes for this run's seat", () => {
    expect(PORTAL_PORT).toBe(harnessPort("portal", PORT_SEAT));
    expect(API_PORT).toBe(harnessPort("api", PORT_SEAT));
    expect(OTLP_PORT).toBe(harnessPort("otlp", PORT_SEAT));
  });

  it("keeps the OTLP receiver off 4318, the OTLP/HTTP default a local viewer holds", () => {
    for (let seat = MIN_PORT_SEAT; seat <= MAX_PORT_SEAT; seat += 1) {
      expect(harnessPort("otlp", seat)).not.toBe(4318);
    }
  });

  it("never lets the two blocks meet", () => {
    const stable = new Set<number>();
    const harness = new Set<number>();
    for (let seat = MIN_PORT_SEAT; seat <= MAX_PORT_SEAT; seat += 1) {
      for (const service of ["portal", "api", "postgres", "artifacts"] as const) {
        stable.add(stablePort(service, seat));
      }
      for (const { port } of harnessPorts(seat)) harness.add(port);
    }
    expect([...harness].filter((port) => stable.has(port))).toEqual([]);
  });
});

describe("assertSeatPortsOutsideEphemeralRange", () => {
  it("passes for every seat against this machine's live range", () => {
    // The real check, on the real value: 17xxx is below the stock 32768-60999 window,
    // and this fails on a machine that moved the window under it.
    for (let seat = MIN_PORT_SEAT; seat <= MAX_PORT_SEAT; seat += 1) {
      expect(() => assertSeatPortsOutsideEphemeralRange(seat)).not.toThrow();
    }
  });

  it("names the offending ports when the range does overlap", () => {
    expect(() => assertSeatPortsOutsideEphemeralRange(1, { low: 17_000, high: 18_000 })).toThrow(
      /17100/,
    );
  });

  it("reads the range from the file rather than assuming it", () => {
    expect(ephemeralPortRange("/definitely/not/a/sysctl")).toBeUndefined();
    const live = ephemeralPortRange();
    // Linux only; elsewhere the assertion degrades to a no-op, which is stated.
    if (live !== undefined) expect(live.low).toBeLessThan(live.high);
  });
});

describe("occupantOfPort", () => {
  it("reports nothing for a port with no listener", async () => {
    // Bind and release, so the port is known to have been bindable and is free now.
    const { port, server } = await listenOnFreePort();
    await close(server);
    expect(occupantOfPort(port)).toBeUndefined();
  });

  it("attributes a real listener to this process and its cwd", async () => {
    const { port } = await listenOnFreePort();
    const found = occupantOfPort(port);
    if (found === undefined) {
      // No `/proc` (not Linux): the refusal degrades to "cannot attribute", which
      // `isAdoptable` already treats as not-mine. Nothing to assert here.
      expect(ephemeralPortRange()).toBeUndefined();
      return;
    }
    expect(found.pid).toBe(process.pid);
    expect(found.cwd).toBe(readlinkSync("/proc/self/cwd"));
  });
});

describe("assertSeatPortsUsable", () => {
  it("passes when nothing holds the seat", () => {
    expect(() => assertSeatPortsUsable(PORT_SEAT, HARNESS_REPO_ROOT, [])).not.toThrow();
  });

  it("refuses a dev server belonging to another worktree, naming pid and cwd", () => {
    // The exact issue #255 shape: another lane's portal dev server is up on the port
    // this run wants. Before the seat scheme, Playwright adopted it and the run went
    // green against that other tree.
    const call = () =>
      assertSeatPortsUsable(0, "/home/dev/qcms", [
        occupant({ pid: 4242, cwd: "/home/dev/qcms-other-worktree" }),
      ]);
    expect(call).toThrow("pid 4242");
    expect(call).toThrow("/home/dev/qcms-other-worktree");
    expect(call).toThrow(PORT_SEAT_ENV_VAR);
  });

  it("adopts a dev server from THIS worktree, which is what local reuse is for", () => {
    expect(() =>
      assertSeatPortsUsable(0, "/home/dev/qcms", [occupant({ cwd: "/home/dev/qcms" })]),
    ).not.toThrow();
    // A trailing slash is how `HARNESS_REPO_ROOT` arrives and not how `/proc` reports
    // a cwd, so the comparison has to survive it or every reuse would be refused.
    expect(() =>
      assertSeatPortsUsable(0, "/home/dev/qcms/", [occupant({ cwd: "/home/dev/qcms" })]),
    ).not.toThrow();
  });

  it("refuses an occupant it cannot attribute, rather than assuming it is ours", () => {
    // "Cannot tell whose it is" and "it is mine" must never collapse into the same
    // outcome: that collapse is precisely how a false green is produced.
    expect(() =>
      assertSeatPortsUsable(0, "/home/dev/qcms", [occupant({ pid: undefined, cwd: undefined })]),
    ).toThrow("unidentified process");
  });

  it("never adopts the API or the OTLP receiver, even from this worktree", () => {
    // Both are bound by the Playwright runner process itself, once per run. A live
    // listener on either is a leak or a concurrent run, never something to join.
    for (const service of ["api", "otlp"] as const) {
      expect(() =>
        assertSeatPortsUsable(0, "/home/dev/qcms", [
          occupant({ service, port: harnessPort(service, 0), cwd: "/home/dev/qcms" }),
        ]),
      ).toThrow(String(harnessPort(service, 0)));
    }
  });
});

describe("isAdoptable", () => {
  it("is false for a different tree, an unknown tree, and a non-reusable service", () => {
    expect(isAdoptable(occupant({ cwd: "/other" }), "/home/dev/qcms")).toBe(false);
    expect(isAdoptable(occupant({ cwd: undefined }), "/home/dev/qcms")).toBe(false);
    expect(isAdoptable(occupant({ service: "api", cwd: "/home/dev/qcms" }), "/home/dev/qcms")).toBe(
      false,
    );
  });

  it("is true only for a reusable service in this exact tree", () => {
    expect(isAdoptable(occupant({ cwd: "/home/dev/qcms" }), "/home/dev/qcms")).toBe(true);
    expect(
      isAdoptable(occupant({ service: "admin", cwd: "/home/dev/qcms" }), "/home/dev/qcms"),
    ).toBe(true);
  });
});
