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

/**
 * Readiness stubs, so the structural half of the rule is testable without a server.
 *
 * Injected rather than mocked: the real probe spawns a child process against a real
 * port, which these cases have no reason to pay for. The probe ITSELF is covered
 * against real listeners in its own describe block below.
 */
const alwaysReady: ReadinessProbe = () => true;
const neverReady: ReadinessProbe = () => false;

/** Child fixtures started by a test, killed even if an expectation throws. */
const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const child of spawned.splice(0)) child.kill("SIGKILL");
});

/**
 * An HTTP server answering `status`, in a SEPARATE process, on a port it picks itself.
 *
 * It has to be a separate process. `probeServiceReady` is synchronous by construction
 * (`spawnSync`), so it blocks this thread's event loop for the whole probe - and an
 * in-process fixture server would therefore never get to answer, deadlocking against
 * the very call under test. Measured, not theorised: the first version of this suite
 * had the server in-process and every probe timed out.
 *
 * The port is reported by the child rather than chosen here, so nothing races another
 * seat, and the listener is left dual-stack (no bind address) because the probe asks
 * for `localhost` and this machine may resolve that either way.
 */
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
    // The compatibility contract. If this ever changes, every developer's bookmark,
    // every doc URL and the devcontainer's `appPort` are wrong at the same moment.
    expect(stablePort("portal", 0)).toBe(7000);
    expect(stablePort("api", 0)).toBe(7010);
    expect(stablePort("postgres", 0)).toBe(7020);
    expect(stablePort("artifacts", 0)).toBe(7030);
    // Published out of the dev container since issue #281, so it is now in `appPort`
    // and in the same contract as the four above rather than a bare allocation.
    expect(stablePort("admin", 0)).toBe(7040);
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
    // A trailing slash is how `HARNESS_REPO_ROOT` arrives and not how `/proc` reports
    // a cwd, so the comparison has to survive it or every reuse would be refused.
    expect(() =>
      assertSeatPortsUsable(0, "/repo/qcms/", [occupant({ cwd: "/repo/qcms" })], alwaysReady),
    ).not.toThrow();
  });

  it("refuses an orphan from this worktree that no longer answers (issue #295)", () => {
    // The whole of issue #295 in one case. A run killed mid-suite leaves its
    // `next-server` reparented to pid 1, listening on the seat, cwd still inside this
    // worktree - structurally indistinguishable from the case above, and it answers
    // nothing. Adopting it was hours of two-minute timeouts; refusing names it.
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
    // "Cannot tell whose it is" and "it is mine" must never collapse into the same
    // outcome: that collapse is precisely how a false green is produced.
    expect(() =>
      assertSeatPortsUsable(0, "/repo/qcms", [occupant({ pid: undefined, cwd: undefined })]),
    ).toThrow("unidentified process");
  });

  it("never adopts the API or the OTLP receiver, even from this worktree", () => {
    // Both are bound by the Playwright runner process itself, once per run. A live
    // listener on either is a leak or a concurrent run, never something to join.
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
    // `.git` is a directory in a normal clone, which is what CI checks out.
    expect(() => assertSeatChosen(primaryCheckout, "")).not.toThrow();
  });

  it("refuses an unset seat in a linked worktree, where lanes actually run", () => {
    // The residual risk after per-seat isolation is not a port collision, it is a
    // SEAT collision: two lanes that both fall back to the default. Every lane runs
    // in a worktree, and a linked worktree has a `.git` FILE, so "I forgot" becomes
    // a startup error before anything binds rather than a second run on seat 0.
    const call = () => assertSeatChosen(linkedWorktree, "");
    expect(call).toThrow(PORT_SEAT_ENV_VAR);
    expect(call).toThrow("linked git worktree");
    expect(() => assertSeatChosen(linkedWorktree, "")).toThrow(PORT_SEAT_ENV_VAR);
  });

  it("accepts any explicit seat in a worktree, including 0", () => {
    // Seat 0 is a legitimate answer when nothing else is running. What is refused is
    // silence, not the value.
    expect(() => assertSeatChosen(linkedWorktree, "0")).not.toThrow();
    expect(() => assertSeatChosen(linkedWorktree, "3")).not.toThrow();
  });
});

describe("adoptableServices", () => {
  it("is empty when the ports are free, so a lost bind race fails loudly", () => {
    // This is the case a probe alone cannot cover. Port free at config load, another
    // run claims it a second later: with reuse OFF that ends in EADDRINUSE, which is
    // the direction the race has to fail in. With reuse ON it would end in a green
    // suite run against the winner's tree, which is issue #255 exactly.
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
    // The `reuseExistingServer` half of issue #295. Refusing the run is one outcome;
    // the flag has to come back empty too, or a future caller that only reads this set
    // would still hand an orphan to Playwright.
    const portal = occupant({ cwd: "/repo/qcms/apps/portal" });
    const admin = occupant({ service: "admin", cwd: "/repo/qcms/apps/admin" });
    expect(adoptableServices(0, "/repo/qcms", [portal, admin], neverReady)).toEqual(new Set());
  });

  it("recognises a dev server by its APP directory, not the repo root", () => {
    // `next dev` runs with its cwd inside the app, so a live portal server reports
    // `<repo>/apps/portal`. An equality test made every one of our own servers
    // unadoptable, which the first concurrent-seat proof run caught.
    const portal = occupant({ cwd: "/repo/qcms/apps/portal" });
    const admin = occupant({ service: "admin", cwd: "/repo/qcms/apps/admin" });
    expect(adoptableServices(0, "/repo/qcms", [portal, admin], alwaysReady)).toEqual(
      new Set(["portal", "admin"]),
    );
    // A sibling worktree whose path merely starts with the same characters is not us.
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
    // The four cases are ordered cheapest-first on purpose: only the last one spawns a
    // probe, so a foreign or unattributable occupant costs nothing to reject.
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
  // The probe itself, against real sockets. Everything above stubs it, so without
  // these three cases the mechanism that decides adoption would be untested.

  it("is true for a server answering below the 400 ceiling", async () => {
    const port = await serveInChildProcess(200);
    expect(probeServiceReady(occupant({ port }))).toBe(true);
  });

  it("is false for a server answering 500, which is not serving this app", async () => {
    // Issue #381's case, one level up: any HTTP answer used to count as alive, and a
    // portal 500ing on every request (an unbuilt `@qcms/ui`) looked exactly like a
    // healthy one. A server in that state is not something to adopt either.
    const port = await serveInChildProcess(500);
    expect(probeServiceReady(occupant({ port }))).toBe(false);
  });

  it("is false for a listener that accepts and never answers, which is the orphan", async () => {
    // A bare TCP listener with no HTTP behind it stands in for the reparented
    // `next-server`: the port is held, the kernel completes the handshake from the
    // listen backlog, and nothing ever comes back. This one can stay in-process
    // precisely because nothing in-process has to run for the connect to succeed.
    // A shorter budget than the real 5s one, because the wait IS the assertion.
    const { port } = await listenOnFreePort();
    expect(probeServiceReady(occupant({ port }), 750)).toBe(false);
  });

  it("is false for a port with nothing on it at all", async () => {
    const { port, server } = await listenOnFreePort();
    await close(server);
    expect(probeServiceReady(occupant({ port }), 750)).toBe(false);
  });
});
