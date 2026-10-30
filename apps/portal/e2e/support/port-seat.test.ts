import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { API_PORT, OTLP_PORT, PORTAL_PORT } from "./harness-config.js";
import {
  DEFAULT_PORT_SEAT,
  HARNESS_REPO_ROOT,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  PORT_SEAT,
  PORT_SEAT_ENV_VAR,
  type ReadinessProbe,
  type SeatPortOccupant,
  adoptableServices,
  adoptionRefusal,
  assertPosixHost,
  assertSeatChosen,
  assertSeatPortsOutsideEphemeralRange,
  assertSeatPortsUsable,
  composeProjectName,
  ephemeralPortRange,
  harnessPort,
  harnessPorts,
  isAdoptable,
  occupantOfPort,
  probeServiceReady,
  resolvePortSeat,
  stablePort,
} from "./port-seat.js";

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

const alwaysReady: ReadinessProbe = () => true;
const neverReady: ReadinessProbe = () => false;

/** Child fixtures started by a test, killed even if an expectation throws. */
const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const child of spawned.splice(0)) child.kill("SIGKILL");
});

async function serveInChildProcess(status: number): Promise<number> {
  const source = `require("node:http")
    .createServer((request, response) => { response.writeHead(${String(status)}); response.end(); })
    .listen(0, function () { console.log(this.address().port); });`;
  const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "ignore"] });
  spawned.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
    child.once("error", reject);
    child.once("exit", () => reject(new Error("fixture server exited before it listened")));
  });
  if (!Number.isInteger(port)) throw new Error("fixture server reported no port");
  return port;
}

/** A checkout shape whose `.git` is a directory (a normal clone, and CI). */
const primaryCheckout = mkdtempSync(join(tmpdir(), "port-seat-primary-"));
mkdirSync(join(primaryCheckout, ".git"));

/** A checkout shape whose `.git` is a file (`gitdir: ...`), i.e. a linked worktree. */
const linkedWorktree = mkdtempSync(join(tmpdir(), "port-seat-worktree-"));
writeFileSync(join(linkedWorktree, ".git"), "gitdir: /somewhere/.git/worktrees/x\n", "utf8");

afterAll(() => {
  for (const dir of [primaryCheckout, linkedWorktree])
    rmSync(dir, { recursive: true, force: true });
});

describe("seat 0 is today's allocation", () => {
  it("puts the human-facing services exactly where they already are", () => {
    expect(stablePort("portal", 0)).toBe(7000);
    expect(stablePort("api", 0)).toBe(7010);
    expect(stablePort("postgres", 0)).toBe(7020);
    expect(stablePort("artifacts", 0)).toBe(7030);
    expect(stablePort("admin", 0)).toBe(7040);
  });

  it("is what an unset environment resolves to", () => {
    expect(resolvePortSeat(undefined)).toBe(DEFAULT_PORT_SEAT);
    expect(DEFAULT_PORT_SEAT).toBe(0);
  });

  it("leaves the Compose project name alone, so no existing database moves", () => {
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
    if (live !== undefined) expect(live.low).toBeLessThan(live.high);
  });
});

describe("occupantOfPort", () => {
  it("reports nothing for a port with no listener", async () => {
    const { port, server } = await listenOnFreePort();
    await close(server);
    expect(occupantOfPort(port)).toBeUndefined();
  });

  it("attributes a real listener to this process and its cwd", async () => {
    const { port } = await listenOnFreePort();
    const found = occupantOfPort(port);
    if (found === undefined) {
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
    const call = () =>
      assertSeatPortsUsable(0, "/repo/qcms", [
        occupant({ pid: 4242, cwd: "/repo/qcms-other-worktree" }),
      ]);
    expect(call).toThrow("pid 4242");
    expect(call).toThrow("/repo/qcms-other-worktree");
    expect(call).toThrow(PORT_SEAT_ENV_VAR);
  });

  it("adopts a LIVE dev server from THIS worktree, which is what local reuse is for", () => {
    expect(() =>
      assertSeatPortsUsable(0, "/repo/qcms", [occupant({ cwd: "/repo/qcms" })], alwaysReady),
    ).not.toThrow();
    expect(() =>
      assertSeatPortsUsable(0, "/repo/qcms/", [occupant({ cwd: "/repo/qcms" })], alwaysReady),
    ).not.toThrow();
  });

  it("refuses an orphan from this worktree that no longer answers (issue #295)", () => {
    const call = () =>
      assertSeatPortsUsable(
        0,
        "/repo/qcms",
        [occupant({ pid: 1234, cwd: "/repo/qcms/apps/portal" })],
        neverReady,
      );
    expect(call).toThrow("pid 1234");
    expect(call).toThrow("did not answer");
    expect(call).toThrow("orphan");
  });

  it("refuses an occupant it cannot attribute, rather than assuming it is ours", () => {
    expect(() =>
      assertSeatPortsUsable(0, "/repo/qcms", [occupant({ pid: undefined, cwd: undefined })]),
    ).toThrow("unidentified process");
  });

  it("says what the machine was doing when it refused (issue #395)", () => {
    const call = () =>
      assertSeatPortsUsable(
        0,
        "/repo/qcms",
        [occupant({ pid: 4242, cwd: "/repo/qcms-other-worktree" })],
        neverReady,
        () => "host: load 18.42 over 8 cpus; containers 14 running, 11 Testcontainers",
      );

    expect(call).toThrow("pid 4242");
    expect(call).toThrow("11 Testcontainers");
  });

  it("never adopts the API or the OTLP receiver, even from this worktree", () => {
    for (const service of ["api", "otlp"] as const) {
      expect(() =>
        assertSeatPortsUsable(0, "/repo/qcms", [
          occupant({ service, port: harnessPort(service, 0), cwd: "/repo/qcms" }),
        ]),
      ).toThrow(String(harnessPort(service, 0)));
    }
  });
});

describe("assertSeatChosen", () => {
  it("lets the primary checkout and CI keep the silent default", () => {
    expect(() => assertSeatChosen(primaryCheckout, "")).not.toThrow();
  });

  it("refuses an unset seat in a linked worktree, where lanes actually run", () => {
    const call = () => assertSeatChosen(linkedWorktree, "");
    expect(call).toThrow(PORT_SEAT_ENV_VAR);
    expect(call).toThrow("linked git worktree");
    expect(() => assertSeatChosen(linkedWorktree, "")).toThrow(PORT_SEAT_ENV_VAR);
  });

  it("accepts any explicit seat in a worktree, including 0", () => {
    expect(() => assertSeatChosen(linkedWorktree, "0")).not.toThrow();
    expect(() => assertSeatChosen(linkedWorktree, "3")).not.toThrow();
  });
});

describe("assertPosixHost", () => {
  it("refuses on win32, where the occupancy guard can see nothing", () => {
    const call = () => assertPosixHost("pnpm verify:browser", "win32");
    expect(call).toThrow("does not run on native Windows");
    expect(call).toThrow("/proc");
    expect(call).toThrow("WSL");
  });

  it("passes on every platform that has /proc", () => {
    expect(() => assertPosixHost("pnpm verify:browser", "linux")).not.toThrow();
  });
});

describe("adoptableServices", () => {
  it("is empty when the ports are free, so a lost bind race fails loudly", () => {
    expect(adoptableServices(0, "/repo/qcms", [], alwaysReady)).toEqual(new Set());
  });

  it("adopts only a same-worktree dev server", () => {
    const mine = occupant({ cwd: "/repo/qcms" });
    const theirs = occupant({ service: "admin", cwd: "/repo/other" });
    expect(adoptableServices(0, "/repo/qcms", [mine, theirs], alwaysReady)).toEqual(
      new Set(["portal"]),
    );
  });

  it("adopts nothing when this worktree's own servers no longer answer", () => {
    const portal = occupant({ cwd: "/repo/qcms/apps/portal" });
    const admin = occupant({ service: "admin", cwd: "/repo/qcms/apps/admin" });
    expect(adoptableServices(0, "/repo/qcms", [portal, admin], neverReady)).toEqual(new Set());
  });

  it("recognises a dev server by its APP directory, not the repo root", () => {
    const portal = occupant({ cwd: "/repo/qcms/apps/portal" });
    const admin = occupant({ service: "admin", cwd: "/repo/qcms/apps/admin" });
    expect(adoptableServices(0, "/repo/qcms", [portal, admin], alwaysReady)).toEqual(
      new Set(["portal", "admin"]),
    );
    expect(
      isAdoptable(occupant({ cwd: "/repo/qcms-other/apps/portal" }), "/repo/qcms", alwaysReady),
    ).toBe(false);
  });
});

describe("isAdoptable", () => {
  it("is false for a different tree, an unknown tree, and a non-reusable service", () => {
    expect(isAdoptable(occupant({ cwd: "/other" }), "/repo/qcms", alwaysReady)).toBe(false);
    expect(isAdoptable(occupant({ cwd: undefined }), "/repo/qcms", alwaysReady)).toBe(false);
    expect(
      isAdoptable(occupant({ service: "api", cwd: "/repo/qcms" }), "/repo/qcms", alwaysReady),
    ).toBe(false);
  });

  it("is true only for a reusable service in this exact tree that answers", () => {
    expect(isAdoptable(occupant({ cwd: "/repo/qcms" }), "/repo/qcms", alwaysReady)).toBe(true);
    expect(
      isAdoptable(occupant({ service: "admin", cwd: "/repo/qcms" }), "/repo/qcms", alwaysReady),
    ).toBe(true);
    expect(isAdoptable(occupant({ cwd: "/repo/qcms" }), "/repo/qcms", neverReady)).toBe(false);
  });

  it("names why it refused, so the message can say more than 'held by pid N'", () => {
    expect(adoptionRefusal(occupant({ service: "api" }), "/repo/qcms", neverReady)).toBe(
      "not-reusable",
    );
    expect(adoptionRefusal(occupant({ cwd: undefined }), "/repo/qcms", neverReady)).toBe(
      "unattributable",
    );
    expect(adoptionRefusal(occupant({ cwd: "/other" }), "/repo/qcms", neverReady)).toBe(
      "foreign-tree",
    );
    expect(adoptionRefusal(occupant({ cwd: "/repo/qcms" }), "/repo/qcms", neverReady)).toBe(
      "not-ready",
    );
    expect(
      adoptionRefusal(occupant({ cwd: "/repo/qcms" }), "/repo/qcms", alwaysReady),
    ).toBeUndefined();
  });
});

describe("probeServiceReady", () => {
  it("is true for a server answering below the 400 ceiling", async () => {
    const port = await serveInChildProcess(200);
    expect(probeServiceReady(occupant({ port }))).toBe(true);
  });

  it("is false for a server answering 500, which is not serving this app", async () => {
    const port = await serveInChildProcess(500);
    expect(probeServiceReady(occupant({ port }))).toBe(false);
  });

  it("is false for a listener that accepts and never answers, which is the orphan", async () => {
    const { port } = await listenOnFreePort();
    expect(probeServiceReady(occupant({ port }), 750)).toBe(false);
  });

  it("is false for a port with nothing on it at all", async () => {
    const { port, server } = await listenOnFreePort();
    await close(server);
    expect(probeServiceReady(occupant({ port }), 750)).toBe(false);
  });
});
