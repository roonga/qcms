/**
 * A diagnosis aid only: it must add no retry, move no timeout, and never turn a red run green. A published
 * subpath, so it cannot import this repository's scripts; the seat is read off Docker's Compose project labels.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

/** The host's run-queue pressure, as the kernel reports it. */
export interface HostLoadSample {
  readonly oneMinute: number;
  readonly fiveMinute: number;
  readonly fifteenMinute: number;
  /** Logical CPUs, so a load figure reads as a ratio. */
  readonly cpus: number;
}

/** One QCMS Compose stack the daemon is carrying. */
export interface StackSample {
  /** The Compose project name, as Docker reports it. */
  readonly project: string;
  /** The seat its name encodes, when it encodes one. */
  readonly seat: number | undefined;
}

/** What the shared Docker daemon was carrying. */
export interface DaemonSample {
  /** Running containers, this process's own included. */
  readonly running: number;
  /** Of those, how many carry a Testcontainers session label. */
  readonly testcontainers: number;
  /** Distinct sessions those containers span; one of them is this run's own. */
  readonly sessions: number;
  /** QCMS Compose stacks that were up, in name order. */
  readonly stacks: readonly StackSample[];
}

/** One sample of the machine. */
export interface HostSnapshot {
  readonly load: HostLoadSample | undefined;
  readonly daemon: DaemonSample | undefined;
  /**
   * What the census cost and whether it finished. Kept beside `daemon` because it survives
   * when `daemon` does not.
   */
  readonly census: DaemonCensusReading | undefined;
}

/**
 * Parse `/proc/loadavg`'s three averages. `undefined` rather than zero on a parse failure:
 * zero is a real load figure.
 */
export function parseLoadAverage(
  text: string | undefined,
  cpus: number,
): HostLoadSample | undefined {
  if (text === undefined) return undefined;
  const fields = text.trim().split(/\s+/).slice(0, 3).map(Number);
  if (fields.length < 3 || fields.some((value) => !Number.isFinite(value))) return undefined;
  const [oneMinute, fiveMinute, fifteenMinute] = fields as [number, number, number];
  return { oneMinute, fiveMinute, fifteenMinute, cpus };
}

/** Best effort: a project whose suffix no longer parses is still listed, with no seat. */
const SEAT_SUFFIX = /-s(\d)$/;

const QCMS_PROJECT_PREFIX = "qcms-";

/** The seat `project` encodes, or `undefined` when it is not a QCMS project. */
export function seatOfProject(project: string): number | undefined {
  if (!project.startsWith(QCMS_PROJECT_PREFIX)) return undefined;
  const matched = SEAT_SUFFIX.exec(project);
  if (matched === null) return 0;
  return Number(matched[1]);
}

/** Docker's own placeholder for a label a container does not carry. */
const EMPTY_LABEL = "<no value>";

function labelValue(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" || value === EMPTY_LABEL ? undefined : value;
}

/** Turn `docker ps` output into a census, one line per running container. */
export function parseDaemonCensus(stdout: string): DaemonSample {
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  const sessions = new Set<string>();
  const projects = new Set<string>();
  let testcontainers = 0;
  for (const line of lines) {
    const [, rawSession, rawProject] = line.split("\t");
    const session = labelValue(rawSession);
    if (session !== undefined) {
      testcontainers += 1;
      sessions.add(session);
    }
    const project = labelValue(rawProject);
    if (project !== undefined && project.startsWith(QCMS_PROJECT_PREFIX)) projects.add(project);
  }
  return {
    running: lines.length,
    testcontainers,
    sessions: sessions.size,
    stacks: [...projects]
      .sort((a, b) => a.localeCompare(b))
      .map((project) => ({ project, seat: seatOfProject(project) })),
  };
}

/**
 * How long the census waits for the Docker CLI. Deliberately not widened: this runs on a
 * path that is already failing, so an overrun is reported as a reading rather than waited
 * out.
 */
export const DOCKER_CENSUS_TIMEOUT_MS = 3_000;

/**
 * Probed rather than resolved through `PATH`, which would launch a subprocess by bare name
 * (`sonarjs/no-os-command-from-path`).
 */
const DOCKER_BINARY_CANDIDATES = [
  "/usr/bin/docker",
  "/usr/local/bin/docker",
  "/bin/docker",
  "/opt/homebrew/bin/docker",
];

/** The Docker CLI arguments the census runs. */
export const DOCKER_CENSUS_ARGS: readonly string[] = [
  "ps",
  "--format",
  '{{.Names}}\t{{.Label "org.testcontainers.session-id"}}\t{{.Label "com.docker.compose.project"}}',
];

/** The readings a snapshot is built from. Injectable so a test needs no host. */
export interface HostProbes {
  /** One census attempt. */
  readonly dockerPs: () => DaemonCensusReading;
  /** `/proc/loadavg`'s contents, or `undefined` where there is no `/proc`. */
  readonly loadavg: () => string | undefined;
  /** Logical CPU count. */
  readonly cpus: () => number;
}

/** One census attempt, and what it cost. */
export interface DaemonCensusReading {
  /** `undefined` when the daemon did not answer. */
  readonly stdout: string | undefined;
  /** Wall clock, set whether the attempt answered or not. */
  readonly elapsedMs: number;
  /** Cut off at its ceiling, as opposed to failing outright. */
  readonly timedOut: boolean;
}

/**
 * Run one census command under a hard ceiling, with every failure swallowed: a diagnostic
 * must not become a new way for an already-failing run to fail.
 */
export function runDockerCensus(
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): DaemonCensusReading {
  const started = Date.now();
  try {
    const stdout = execFileSync(binary, [...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { stdout, elapsedMs: Date.now() - started, timedOut: false };
  } catch (cause) {
    const elapsedMs = Date.now() - started;
    // The elapsed comparison covers a platform that does not report `ETIMEDOUT`.
    const code = (cause as { code?: unknown }).code;
    return {
      stdout: undefined,
      elapsedMs,
      timedOut: code === "ETIMEDOUT" || elapsedMs >= timeoutMs,
    };
  }
}

function probeDockerPs(): DaemonCensusReading {
  const binary = DOCKER_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (binary === undefined) return { stdout: undefined, elapsedMs: 0, timedOut: false };
  return runDockerCensus(binary, DOCKER_CENSUS_ARGS, DOCKER_CENSUS_TIMEOUT_MS);
}

function probeLoadAverage(): string | undefined {
  try {
    return readFileSync("/proc/loadavg", "utf8");
  } catch {
    return undefined;
  }
}

/** The real host. */
export const HOST_PROBES: HostProbes = {
  dockerPs: probeDockerPs,
  loadavg: probeLoadAverage,
  cpus: availableParallelism,
};

/** Sample the machine now. */
export function sampleHost(probes: HostProbes = HOST_PROBES): HostSnapshot {
  const census = probes.dockerPs();
  return {
    load: parseLoadAverage(probes.loadavg(), probes.cpus()),
    daemon: census.stdout === undefined ? undefined : parseDaemonCensus(census.stdout),
    census,
  };
}

function describeLoad(load: HostLoadSample | undefined): string {
  if (load === undefined) return "load unknown (no /proc/loadavg)";
  const perCpu = (load.oneMinute / load.cpus).toFixed(2);
  return (
    `load ${load.oneMinute.toFixed(2)}/${load.fiveMinute.toFixed(2)}/${load.fifteenMinute.toFixed(2)}` +
    ` over ${String(load.cpus)} cpus (${perCpu} per cpu)`
  );
}

function describeStack(stack: StackSample): string {
  return stack.seat === undefined ? stack.project : `seat ${String(stack.seat)} (${stack.project})`;
}

/** The two cases stay apart: no Docker and a daemon too busy to answer are opposite facts. */
function describeMissingCensus(census: DaemonCensusReading | undefined): string {
  if (census?.timedOut !== true) return "docker unknown (the daemon could not be asked)";
  return `docker unknown (the daemon did not answer the census within ${String(census.elapsedMs)}ms)`;
}

function describeCensusCost(census: DaemonCensusReading | undefined): string {
  return census === undefined ? "" : ` in ${String(census.elapsedMs)}ms`;
}

function describeDaemon(
  daemon: DaemonSample | undefined,
  census: DaemonCensusReading | undefined,
): string {
  if (daemon === undefined) return describeMissingCensus(census);
  // The cost rides along even on success: a slow answer is itself a loaded daemon.
  const containers =
    `docker ${String(daemon.running)} running, ${String(daemon.testcontainers)} Testcontainers` +
    ` across ${String(daemon.sessions)} session${daemon.sessions === 1 ? "" : "s"}` +
    describeCensusCost(census);
  const stacks =
    daemon.stacks.length === 0
      ? "no QCMS stacks"
      : `QCMS stacks ${daemon.stacks.map(describeStack).join(", ")}`;
  return `${containers}; ${stacks}`;
}

/** The prefix every snapshot line carries, so it is greppable in test output. */
export const HOST_SNAPSHOT_PREFIX = "  host:";

/** The snapshot as one line: it is appended to a failure message in a test log. */
export function formatHostSnapshot(snapshot: HostSnapshot): string {
  return `${HOST_SNAPSHOT_PREFIX} ${describeLoad(snapshot.load)}; ${describeDaemon(snapshot.daemon, snapshot.census)} (issue #812: what the host was doing, not a cause)`;
}

/**
 * How long a sample is reused. Cached because a failing suite can reject hundreds of queries
 * a second, and a `docker ps` per rejection would make this diagnostic a load source on the
 * machine it measures.
 */
export const HOST_SNAPSHOT_CACHE_MS = 5_000;

/** The same window for a timed-out census, longer because that one cost its whole ceiling. */
export const HOST_SNAPSHOT_SLOW_CENSUS_CACHE_MS = 30_000;

let cached: { at: number; line: string; window: number } | undefined;

/**
 * The snapshot line, sampling at most once per cache window. Never throws: a probe that
 * fails renders as "unknown" so the caller's own error surfaces.
 */
export function hostSnapshotLine(
  probes: HostProbes = HOST_PROBES,
  now: number = Date.now(),
): string {
  if (cached !== undefined && now - cached.at < cached.window) return cached.line;
  let line: string;
  let window = HOST_SNAPSHOT_CACHE_MS;
  try {
    const snapshot = sampleHost(probes);
    line = formatHostSnapshot(snapshot);
    if (snapshot.census?.timedOut === true) window = HOST_SNAPSHOT_SLOW_CENSUS_CACHE_MS;
  } catch {
    line = formatHostSnapshot({ load: undefined, daemon: undefined, census: undefined });
  }
  cached = { at: now, line, window };
  return line;
}

/** Drop the cached sample, so one test does not inherit another's reading. */
export function resetHostSnapshotCache(): void {
  cached = undefined;
}
