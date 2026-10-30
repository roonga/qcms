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
  assertPosixHost,
  assertSeatPortsOutsideEphemeralRange,
  harnessPorts,
  withoutTrailingSlash,
} from "../../../../scripts/ports.mjs";

import { hostLineOnce } from "./host-pressure.js";

export {
  DEFAULT_PORT_SEAT,
  HARNESS_SERVICES,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  PORT_SEAT,
  PORT_SEAT_ENV_VAR,
  STABLE_SERVICES,
  assertPosixHost,
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

const HARNESS_SERVICE_REUSE: Record<
  HarnessService,
  { reusable: boolean; label: string; readyPath?: string }
> = {
  portal: { reusable: true, label: "portal dev server", readyPath: "/" },
  api: { reusable: false, label: "composed API (globalSetup)" },
  otlp: { reusable: false, label: "in-test OTLP receiver" },
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
    return false;
  }
  for (const descriptor of descriptors) {
    try {
      if (targets.has(readlinkSync(`/proc/${entry}/fd/${descriptor}`))) return true;
    } catch {
      // A descriptor the process closed between the listing and the read.
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

export function probeServiceReady(
  occupant: SeatPortOccupant,
  timeoutMs: number = READY_PROBE_TIMEOUT_MS,
): boolean {
  const key = `${String(occupant.port)}:${String(timeoutMs)}`;
  const cached = readyProbeResults.get(key);
  if (cached !== undefined) return cached;
  const { readyPath } = HARNESS_SERVICE_REUSE[occupant.service];
  const probed =
    readyPath === undefined
      ? undefined
      : spawnSync(
          process.execPath,
          [READY_PROBE_SCRIPT, String(occupant.port), readyPath, String(timeoutMs)],
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

export function assertSeatPortsUsable(
  seat: number = PORT_SEAT,
  repoRoot: string = HARNESS_REPO_ROOT,
  occupants: readonly SeatPortOccupant[] = seatOccupants(seat),
  probe: ReadinessProbe = probeServiceReady,
  hostLine: () => string = hostLineOnce,
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
      `  ${hostLine()}`,
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

export function assertSeatChosen(
  repoRoot: string = HARNESS_REPO_ROOT,
  raw: string | undefined = process.env[PORT_SEAT_ENV_VAR],
): void {
  assertPortSeatChosen(repoRoot, "pnpm verify:browser", raw);
}

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
  assertPosixHost("pnpm verify:browser");
  assertSeatChosen();
  assertSeatPortsOutsideEphemeralRange(seat);
  const occupants = seatOccupants(seat);
  assertSeatPortsUsable(seat, HARNESS_REPO_ROOT, occupants);
  process.env[PREFLIGHT_DONE_VAR] = "1";
  return adoptableServices(seat, HARNESS_REPO_ROOT, occupants);
}

/** Every startup refusal, in the order a run needs them. Exported for tests. */
export function assertSeatUsable(seat: number = PORT_SEAT): void {
  assertPosixHost("pnpm verify:browser");
  assertSeatChosen();
  assertSeatPortsOutsideEphemeralRange(seat);
  assertSeatPortsUsable(seat);
}
