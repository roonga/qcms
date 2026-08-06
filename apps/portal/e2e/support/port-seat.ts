/**
 * Harness-side port seating: which `17Sxx` ports this run owns, and the refusal that
 * stops it adopting somebody else's (issue #255).
 *
 * The arithmetic and the rule itself live in `scripts/ports.mjs`, which is the one
 * place either is written down; `docs/PORTS.md` is the authoritative prose. This
 * module re-exports what the harness needs and adds the part that only the harness
 * needs: reading `/proc` to find out who is already listening on this seat's ports,
 * and refusing to start when the answer is anyone but us.
 *
 * ## Why the refusal exists
 *
 * The harness ports used to be compile-time literals (3100 / 3200 / 4010 / 4319) and
 * the root Playwright config sets `reuseExistingServer: !CI`. So a second agent lane
 * starting a browser run while the first lane's dev servers were up did not fail to
 * bind and did not warn: Playwright *reused* the first lane's servers, and the second
 * lane's specs exercised the first lane's worktree while reporting a full green run.
 * A false green there is indistinguishable from a real one, and the merge gate treats
 * a green browser suite as evidence. Seats make the ports differ, so two seats cannot
 * meet at all; this refusal is the backstop for everything else that might be sitting
 * on the block, and it names the occupant the way the original collision was found by
 * hand - by reading `/proc/<pid>/cwd`.
 */

import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  HARNESS_SERVICES,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  PORT_SEAT,
  PORT_SEAT_ENV_VAR,
  assertPortSeatChosen,
  assertSeatPortsOutsideEphemeralRange,
  harnessPorts,
  withoutTrailingSlash,
} from "../../../../scripts/ports.mjs";

export {
  DEFAULT_PORT_SEAT,
  HARNESS_SERVICES,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  PORT_SEAT,
  PORT_SEAT_ENV_VAR,
  STABLE_SERVICES,
  assertSeatPortsOutsideEphemeralRange,
  composeProjectName,
  ephemeralPortRange,
  harnessPort,
  harnessPorts,
  isLinkedWorktree,
  resolvePortSeat,
  stablePort,
} from "../../../../scripts/ports.mjs";

/** A harness service that takes a port from the seat's `17Sxx` block. */
export type HarnessService = keyof typeof HARNESS_SERVICES;

/**
 * Whether Playwright may legitimately adopt a process already listening for this
 * service, and how to name it in a refusal.
 *
 * This is what separates the two kinds of occupancy. The two Next dev servers are
 * `webServer` entries with `reuseExistingServer: !CI`, so a server left behind by a
 * previous run **in this same worktree** is a supported local convenience. The
 * composed API and the OTLP receiver are bound by the Playwright runner process
 * itself, once per run; a live listener on either is a leak or a concurrent run, and
 * never something this run can join, whoever owns it.
 */
const HARNESS_SERVICE_REUSE: Record<HarnessService, { reusable: boolean; label: string }> = {
  portal: { reusable: true, label: "portal dev server" },
  api: { reusable: false, label: "composed API (globalSetup)" },
  otlp: { reusable: false, label: "in-test OTLP receiver" },
  admin: { reusable: true, label: "admin dev server" },
};

/** The repo root this harness belongs to, resolved from this file, not the cwd. */
export const HARNESS_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A process found listening on one of this seat's harness ports. */
export interface SeatPortOccupant {
  readonly service: HarnessService;
  readonly port: number;
  /** The listening process, when `/proc` could identify it. */
  readonly pid: number | undefined;
  /** That process's working directory, which on a dev server is its repo root. */
  readonly cwd: string | undefined;
}

/** `st` value for `TCP_LISTEN` in `/proc/net/tcp`. */
const TCP_LISTEN = "0A";

/** Inode numbers of every listening TCP socket bound to `port`, from `/proc`. */
function listeningSocketInodes(port: number): Set<string> {
  const inodes = new Set<string>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = readFileSync(table, "utf8");
    } catch {
      // No `/proc` (or no permission): occupancy is then only detectable, not
      // attributable, which the caller handles by reporting an unknown pid.
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      const localAddress = columns[1];
      const state = columns[3];
      const inode = columns[9];
      if (localAddress === undefined || state !== TCP_LISTEN || inode === undefined) continue;
      const hexPort = localAddress.split(":")[1];
      if (hexPort !== undefined && Number.parseInt(hexPort, 16) === port) inodes.add(inode);
    }
  }
  return inodes;
}

/** True when pid directory `entry` has any of `targets` open as a file descriptor. */
function processHoldsAny(entry: string, targets: Set<string>): boolean {
  let descriptors;
  try {
    descriptors = readdirSync(`/proc/${entry}/fd`);
  } catch {
    // Another user's process, or one that exited mid-scan.
    return false;
  }
  for (const descriptor of descriptors) {
    try {
      if (targets.has(readlinkSync(`/proc/${entry}/fd/${descriptor}`))) return true;
    } catch {
      // The descriptor closed between the listing and the readlink.
    }
  }
  return false;
}

/** The pid holding any of `inodes` open, by scanning `/proc/<pid>/fd`. */
function pidHoldingSocket(inodes: Set<string>): number | undefined {
  if (inodes.size === 0) return undefined;
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }
  const targets = new Set([...inodes].map((inode) => `socket:[${inode}]`));
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    if (processHoldsAny(entry, targets)) return Number(entry);
  }
  return undefined;
}

/** `pid`'s working directory, which is the repo root a dev server was spawned in. */
function cwdOf(pid: number | undefined): string | undefined {
  if (pid === undefined) return undefined;
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return undefined;
  }
}

/**
 * Who is listening on `port`, or `undefined` when nothing is.
 *
 * `pid`/`cwd` can still be `undefined` on a real listener (another user's process, or
 * another PID namespace), which callers must treat as "not mine" rather than "free".
 */
export function occupantOfPort(
  port: number,
): { pid: number | undefined; cwd: string | undefined } | undefined {
  if (!existsSync("/proc/net/tcp")) return undefined;
  const inodes = listeningSocketInodes(port);
  if (inodes.size === 0) return undefined;
  const pid = pidHoldingSocket(inodes);
  return { pid, cwd: cwdOf(pid) };
}

/** Every one of this seat's harness ports that already has a listener. */
export function seatOccupants(seat: number = PORT_SEAT): SeatPortOccupant[] {
  const found: SeatPortOccupant[] = [];
  for (const { service, port } of harnessPorts(seat)) {
    const occupant = occupantOfPort(port);
    if (occupant === undefined) continue;
    found.push({ service, port, pid: occupant.pid, cwd: occupant.cwd });
  }
  return found;
}

/**
 * True when `cwd` is inside `repoRoot` (or is it).
 *
 * A prefix test rather than equality, because the dev servers do not sit at the repo
 * root: `next dev` runs with its cwd in the app directory, so a live portal server
 * reports `<repo>/apps/portal` and the admin `<repo>/apps/admin`. Measured, not
 * assumed - an equality test made every one of our own servers unadoptable. The
 * trailing separator is what keeps `/repo` from matching `/repo-other`.
 */
function isInside(cwd: string, repoRoot: string): boolean {
  const root = withoutTrailingSlash(repoRoot);
  const path = withoutTrailingSlash(cwd);
  return path === root || path.startsWith(`${root}/`);
}

/** True when this occupant is a server this run may adopt rather than refuse. */
export function isAdoptable(occupant: SeatPortOccupant, repoRoot: string): boolean {
  if (!HARNESS_SERVICE_REUSE[occupant.service].reusable) return false;
  if (occupant.cwd === undefined) return false;
  return isInside(occupant.cwd, repoRoot);
}

/** How one refused occupant reads in the thrown message. */
export function describeOccupant(occupant: SeatPortOccupant): string {
  const who =
    occupant.pid === undefined
      ? "an unidentified process (its pid could not be read from /proc)"
      : `pid ${String(occupant.pid)} (cwd ${occupant.cwd ?? "unknown"})`;
  const label = HARNESS_SERVICE_REUSE[occupant.service].label;
  return `  - port ${String(occupant.port)} (${label}) is held by ${who}`;
}

/**
 * Refuse to start when this seat's ports are held by anything this run cannot
 * honestly adopt.
 *
 * Called from `playwright.config.ts` at module load, which is the earliest moment
 * available and, critically, before Playwright evaluates `reuseExistingServer`. A
 * cross-seat clash therefore ends as a loud refusal naming the occupant, never as a
 * silent reuse that reports green for a tree it never loaded.
 *
 * A dev server left listening by a previous run **in this same worktree** is adopted,
 * unchanged: that is what `reuseExistingServer: !CI` is for locally, and reusing your
 * own tree's server tests your own tree. Everything else is refused, including an
 * occupant whose owner cannot be determined, because "cannot tell whose it is" and
 * "it is mine" must never collapse into the same outcome.
 */
export function assertSeatPortsUsable(
  seat: number = PORT_SEAT,
  repoRoot: string = HARNESS_REPO_ROOT,
  occupants: readonly SeatPortOccupant[] = seatOccupants(seat),
): void {
  const refused = occupants.filter((occupant) => !isAdoptable(occupant, repoRoot));
  if (refused.length === 0) return;
  throw new Error(
    [
      `Port seat ${String(seat)} is not usable from ${repoRoot}:`,
      ...refused.map(describeOccupant),
      "",
      `Pick a free seat with ${PORT_SEAT_ENV_VAR}=<${String(MIN_PORT_SEAT)}-${String(MAX_PORT_SEAT)}>`,
      "(seat S owns 7S00-7S99 and 17S00-17S99), or stop whatever is holding these",
      "ports. Refusing rather than reusing: a reused server would run this suite",
      "against another worktree and still report green. See docs/PORTS.md.",
    ].join("\n"),
  );
}

/**
 * Refuse an unset seat when running from a linked git worktree.
 *
 * This is the one mechanism here that addresses the residual risk, and it is worth
 * being precise about why the others do not. Per-seat isolation makes two seats
 * unable to meet. The occupancy refusal above is only a **diagnostic**: between its
 * probe and the actual bind there is a window in which another run can claim the
 * port, and a sibling lane lost exactly that race on 2026-08-02. So the remaining way
 * this fails is not a port collision, it is a **seat collision**: two runs that both
 * default to seat 0.
 *
 * The rule and its reasoning now live in `scripts/ports.mjs`, because the full-stack
 * Compose harness needs the identical refusal (issue #296) and two copies of a safety
 * rule are how one of them goes stale. This wrapper keeps the browser harness's own
 * defaults: the repo root resolved from this file, and a hint naming the command a
 * reader of this refusal was actually running.
 */
export function assertSeatChosen(
  repoRoot: string = HARNESS_REPO_ROOT,
  raw: string | undefined = process.env[PORT_SEAT_ENV_VAR],
): void {
  assertPortSeatChosen(repoRoot, "pnpm verify:browser", raw);
}

/**
 * Which of this seat's reusable servers are provably ours, right now.
 *
 * Playwright's `reuseExistingServer` is the amplifier that turns a collision from a
 * noisy `EADDRINUSE` into a silent green run against somebody else's tree. It is
 * therefore enabled only where reuse is provably safe: a live portal or admin dev
 * server whose `/proc/<pid>/cwd` is this exact worktree. When the port is free at
 * config load it is left OFF, so a run that loses the bind race to another process
 * fails loudly instead of adopting the winner. That is the direction the race must
 * fail in, and it is the part a probe alone cannot give you.
 */
export function adoptableServices(
  seat: number = PORT_SEAT,
  repoRoot: string = HARNESS_REPO_ROOT,
  occupants: readonly SeatPortOccupant[] = seatOccupants(seat),
): Set<HarnessService> {
  return new Set(
    occupants.filter((occupant) => isAdoptable(occupant, repoRoot)).map(({ service }) => service),
  );
}

/**
 * Sentinel marking that the preflight has already run in this process tree.
 *
 * Playwright loads `playwright.config.ts` again in every worker process, and by then
 * `globalSetup` has bound the composed API and the OTLP receiver on this seat's
 * ports. Those two are never adoptable by design, so a second, unguarded preflight
 * would refuse the run's *own* servers partway through - measured, not theorised: it
 * failed the first concurrent-seat proof run in exactly that way.
 *
 * An environment sentinel rather than a module-level boolean, because each worker is
 * a separate process. Playwright spawns workers from the runner, so a value set here
 * during the runner's own config load is inherited by every worker.
 */
export const PREFLIGHT_DONE_VAR = "QCMS_PORT_SEAT_PREFLIGHT_DONE";

/**
 * The whole startup preflight, run exactly once per Playwright invocation.
 *
 * Returns the services this run may adopt, which is what `reuseExistingServer` is
 * driven from. In a worker (or any second load) it returns an empty set and checks
 * nothing: the `webServer` entries are only acted on by the runner anyway.
 */
export function seatPreflight(seat: number = PORT_SEAT): Set<HarnessService> {
  if (process.env[PREFLIGHT_DONE_VAR] === "1") return new Set();
  assertSeatChosen();
  assertSeatPortsOutsideEphemeralRange(seat);
  const occupants = seatOccupants(seat);
  assertSeatPortsUsable(seat, HARNESS_REPO_ROOT, occupants);
  process.env[PREFLIGHT_DONE_VAR] = "1";
  return adoptableServices(seat, HARNESS_REPO_ROOT, occupants);
}

/** Every startup refusal, in the order a run needs them. Exported for tests. */
export function assertSeatUsable(seat: number = PORT_SEAT): void {
  assertSeatChosen();
  assertSeatPortsOutsideEphemeralRange(seat);
  assertSeatPortsUsable(seat);
}
