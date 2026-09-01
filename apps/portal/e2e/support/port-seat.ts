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
 *
 * ## Why `/proc` alone is not the whole test (issue #295)
 *
 * The adoption rule was originally structural: a reusable service, in this worktree.
 * An orphan satisfies all of it. A run killed mid-suite leaves its `next-server`
 * reparented to pid 1, still bound to the seat, still naming this worktree as its cwd,
 * and answering nothing - so the next run adopted it and every test died on a
 * two-minute timeout, with hours more queued. So adoption also requires the listener to
 * answer a readiness probe **now**, which is the only question that distinguishes "a
 * server this run may join" from "a corpse holding a port".
 */

import { spawnSync } from "node:child_process";
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
 * service, how to name it in a refusal, and where it answers a readiness probe.
 *
 * This is what separates the two kinds of occupancy. The two Next dev servers are
 * `webServer` entries with `reuseExistingServer: !CI`, so a server left behind by a
 * previous run **in this same worktree** is a supported local convenience. The
 * composed API and the OTLP receiver are bound by the Playwright runner process
 * itself, once per run; a live listener on either is a leak or a concurrent run, and
 * never something this run can join, whoever owns it.
 *
 * `readyPath` is the path the corresponding `webServer` entry in
 * `playwright.config.ts` polls, and it exists only for the two reusable services -
 * nothing else is ever probed, because nothing else is ever a candidate.
 */
const HARNESS_SERVICE_REUSE: Record<
  HarnessService,
  { reusable: boolean; label: string; readyPath?: string }
> = {
  portal: { reusable: true, label: "portal dev server", readyPath: "/" },
  api: { reusable: false, label: "composed API (globalSetup)" },
  otlp: { reusable: false, label: "in-test OTLP receiver" },
  // `/healthz` rather than `/`, for the reason the admin `webServer` entry records:
  // the admin's pages need the API that globalSetup has not booted yet.
  admin: { reusable: true, label: "admin dev server", readyPath: "/healthz" },
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

/** How long one readiness probe waits for an answer before calling the port dead. */
export const READY_PROBE_TIMEOUT_MS = 5_000;

/** The child process that does one readiness request. See `ready-probe.mjs`. */
const READY_PROBE_SCRIPT = fileURLToPath(new URL("./ready-probe.mjs", import.meta.url));

/** Verdicts already taken this process, keyed by the port and the budget probed. */
const readyProbeResults = new Map<string, boolean>();

/**
 * True when the occupant answers on its service's readiness path.
 *
 * `spawnSync` rather than `fetch`, because the whole preflight is synchronous: it runs
 * at Playwright config load, which is the only moment before `reuseExistingServer` is
 * acted on, and there is no synchronous HTTP client in Node. `ready-probe.mjs` records
 * the rest of that reasoning.
 *
 * Memoised because `seatPreflight` asks the same question twice (once to refuse, once
 * to decide what to adopt) over one snapshot of occupants, and a probe is a process
 * spawn. One verdict per port per run is also the honest granularity: a server that
 * changed its mind between the two calls is not something to adopt either way.
 */
export function probeServiceReady(
  occupant: SeatPortOccupant,
  timeoutMs: number = READY_PROBE_TIMEOUT_MS,
): boolean {
  const key = `${String(occupant.port)}:${String(timeoutMs)}`;
  const cached = readyProbeResults.get(key);
  if (cached !== undefined) return cached;
  const { readyPath } = HARNESS_SERVICE_REUSE[occupant.service];
  // Only the reusable services have a path, and only they ever reach this function.
  const probed =
    readyPath === undefined
      ? undefined
      : spawnSync(
          process.execPath,
          [READY_PROBE_SCRIPT, String(occupant.port), readyPath, String(timeoutMs)],
          // A hard ceiling above the probe's own budget: the probe settles itself, and
          // this is the backstop for a child that never runs at all.
          { stdio: "ignore", timeout: timeoutMs * 2 },
        );
  const ready = probed?.status === 0;
  readyProbeResults.set(key, ready);
  return ready;
}

/** Decides whether a live listener may be adopted. Injectable so tests need no server. */
export type ReadinessProbe = (occupant: SeatPortOccupant) => boolean;

/** Why an occupant cannot be adopted. */
export type AdoptionRefusal = "not-reusable" | "unattributable" | "foreign-tree" | "not-ready";

/**
 * Why this run may not adopt `occupant`, or `undefined` when it may.
 *
 * The last clause is the one issue #295 added, and it is a different question from the
 * three above it. "A dev server in my worktree" and "a dev server still owned by a live
 * run" are not the same condition, and only the second makes adoption safe. A run
 * killed mid-suite leaves its `next-server` reparented to pid 1, still listening on the
 * seat, still reporting this worktree as its cwd - so it satisfies every structural
 * test and answers nothing. Adopting it converted an interrupted run into hours of
 * two-minute timeouts for whoever ran next, which is the opposite of the clear named
 * error the seat scheme exists to produce.
 *
 * So the orphan is treated as the third case `docs/PORTS.md` argues for rather than
 * being folded into "it is mine": it is refused, named, and replaced.
 */
export function adoptionRefusal(
  occupant: SeatPortOccupant,
  repoRoot: string,
  probe: ReadinessProbe = probeServiceReady,
): AdoptionRefusal | undefined {
  if (!HARNESS_SERVICE_REUSE[occupant.service].reusable) return "not-reusable";
  if (occupant.cwd === undefined) return "unattributable";
  if (!isInside(occupant.cwd, repoRoot)) return "foreign-tree";
  if (!probe(occupant)) return "not-ready";
  return undefined;
}

/** True when this occupant is a server this run may adopt rather than refuse. */
export function isAdoptable(
  occupant: SeatPortOccupant,
  repoRoot: string,
  probe: ReadinessProbe = probeServiceReady,
): boolean {
  return adoptionRefusal(occupant, repoRoot, probe) === undefined;
}

/** How one refused occupant reads in the thrown message. */
export function describeOccupant(occupant: SeatPortOccupant, refusal?: AdoptionRefusal): string {
  const who =
    occupant.pid === undefined
      ? "an unidentified process (its pid could not be read from /proc)"
      : `pid ${String(occupant.pid)} (cwd ${occupant.cwd ?? "unknown"})`;
  const label = HARNESS_SERVICE_REUSE[occupant.service].label;
  const line = `  - port ${String(occupant.port)} (${label}) is held by ${who}`;
  if (refusal !== "not-ready") return line;
  return `${line}, which is in this worktree but did not answer within ${String(
    READY_PROBE_TIMEOUT_MS,
  )}ms: an orphan from a killed run, not a server to adopt`;
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
 * A **live** dev server left listening by a previous run in this same worktree is
 * adopted, unchanged: that is what `reuseExistingServer: !CI` is for locally, and
 * reusing your own tree's server tests your own tree. Everything else is refused,
 * including an occupant whose owner cannot be determined, because "cannot tell whose it
 * is" and "it is mine" must never collapse into the same outcome - and, since issue
 * #295, including one in this worktree that no longer answers, because "it was mine"
 * and "it is serving" must not collapse either.
 */
export function assertSeatPortsUsable(
  seat: number = PORT_SEAT,
  repoRoot: string = HARNESS_REPO_ROOT,
  occupants: readonly SeatPortOccupant[] = seatOccupants(seat),
  probe: ReadinessProbe = probeServiceReady,
): void {
  const refused = occupants
    .map((occupant) => ({ occupant, refusal: adoptionRefusal(occupant, repoRoot, probe) }))
    .filter((entry) => entry.refusal !== undefined);
  if (refused.length === 0) return;
  const orphaned = refused.some((entry) => entry.refusal === "not-ready");
  throw new Error(
    [
      `Port seat ${String(seat)} is not usable from ${repoRoot}:`,
      ...refused.map((entry) => describeOccupant(entry.occupant, entry.refusal)),
      "",
      `Pick a free seat with ${PORT_SEAT_ENV_VAR}=<${String(MIN_PORT_SEAT)}-${String(MAX_PORT_SEAT)}>`,
      "(seat S owns 7S00-7S99 and 17S00-17S99), or stop whatever is holding these",
      "ports. Refusing rather than reusing: a reused server would run this suite",
      "against another worktree and still report green. See docs/PORTS.md.",
      ...(orphaned
        ? [
            "",
            "A listener that does not answer is usually a dev server orphaned by a run",
            "that was killed (its parent is pid 1). Kill it and start again; it would",
            "have failed every test on a timeout rather than reporting anything useful.",
          ]
        : []),
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
 * therefore enabled only where reuse is provably safe: a portal or admin dev server
 * whose `/proc/<pid>/cwd` is this exact worktree **and** which answers a readiness
 * probe now (issue #295). When the port is free at config load it is left OFF, so a run
 * that loses the bind race to another process fails loudly instead of adopting the
 * winner. That is the direction the race must fail in, and it is the part a probe alone
 * cannot give you.
 */
export function adoptableServices(
  seat: number = PORT_SEAT,
  repoRoot: string = HARNESS_REPO_ROOT,
  occupants: readonly SeatPortOccupant[] = seatOccupants(seat),
  probe: ReadinessProbe = probeServiceReady,
): Set<HarnessService> {
  return new Set(
    occupants
      .filter((occupant) => isAdoptable(occupant, repoRoot, probe))
      .map(({ service }) => service),
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
