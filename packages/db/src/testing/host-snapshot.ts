/**
 * What the machine was doing when a container boot or a pooled connection failed
 * (issues #812 and #395).
 *
 * ## The failure this exists for
 *
 * A forced Docker-backed run on a busy workstation goes red roughly one time in three,
 * in a file the branch does not touch, and green in isolation every time. The text it
 * fails with names a port (`not bound after 210000ms`) or a socket (`Connection
 * terminated unexpectedly`), and neither names the thing that actually happened: up to
 * eleven other `postgres:16-alpine` boots from sibling lanes were queued on the same
 * Docker daemon and the same CPUs. The reader is then left to choose between believing
 * a defect they cannot reproduce and re-running the whole suite to find out. Both cost a
 * cycle, and the second one is the cheap answer only because the first is wrong.
 *
 * So the harness says what it saw. One line, appended to the failure message it already
 * produces: how loaded the host was, how many containers the daemon was carrying, how
 * many of those belong to a Testcontainers session, and which QCMS seats had a Compose
 * stack up. That is enough to tell contention from a defect without re-running anything.
 *
 * ## What it is not
 *
 * It is a **diagnosis aid and nothing else**. It adds no retry, moves no timeout, and
 * serialises no boot (that last one is issue #746's open design question and is
 * deliberately not answered here). A failure that would have been red stays red, with
 * the same cause and the same `cause` chain; it just no longer omits the machine. A high
 * load figure is evidence, never a verdict: a real defect can happen on a busy host too,
 * and the line is worded so a reader draws the conclusion rather than being handed one.
 *
 * ## Why this lives in the published package rather than reusing the portal's copy
 *
 * `apps/portal/e2e/support/contention.ts` samples the same machine for the browser
 * suite, and this is deliberately not an import of it. `@roonga/qcms-db/testing` is
 * published: an adopter gets this harness with none of this repository's scripts,
 * worktrees or Playwright configuration, so anything it reaches for has to be something
 * a bare install still has. That rules out `scripts/ports.mjs`, which is where the port
 * arithmetic lives and must stay (R8), and it is why the seat here is read off Docker's
 * own Compose project labels rather than computed from a port block.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

/** The host's run-queue pressure, as the kernel reports it. */
export interface HostLoadSample {
  readonly oneMinute: number;
  readonly fiveMinute: number;
  readonly fifteenMinute: number;
  /** Logical CPUs, so a load figure reads as a ratio rather than a magnitude. */
  readonly cpus: number;
}

/** One QCMS Compose stack the daemon is carrying. */
export interface StackSample {
  /** The Compose project name, exactly as Docker reports it. */
  readonly project: string;
  /** The seat its name encodes, when it encodes one. */
  readonly seat: number | undefined;
}

/** What the shared Docker daemon was carrying. */
export interface DaemonSample {
  /** Every running container, this process's own included. */
  readonly running: number;
  /** Of those, how many carry a Testcontainers session label. */
  readonly testcontainers: number;
  /** How many DISTINCT Testcontainers sessions those containers span. */
  readonly sessions: number;
  /** QCMS Compose stacks that were up, in name order. */
  readonly stacks: readonly StackSample[];
}

/** One sample of the machine. */
export interface HostSnapshot {
  readonly load: HostLoadSample | undefined;
  readonly daemon: DaemonSample | undefined;
}

/**
 * Parse `/proc/loadavg`'s three averages.
 *
 * Split from the read so it is testable without a kernel. Anything that does not yield
 * three finite numbers is `undefined` rather than zero: zero is a real, meaningful load
 * figure, and a parse failure rendered as one would read as "the machine was idle" in
 * exactly the message someone is using to decide whether it was.
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

/**
 * The Compose project naming convention, read rather than computed.
 *
 * `scripts/ports.mjs` builds these names (`qcms-dev`, `qcms-dev-s3`, `qcms-local-stack`,
 * `qcms-local-stack-s4`) and is the only place that arithmetic is allowed to live. A
 * published package cannot import it, so this reads the seat back off the name Docker
 * reports, best effort. If the convention ever changes, a project whose suffix no longer
 * parses is still listed by name with no seat attached: the drift costs a label, not a
 * wrong one.
 */
const SEAT_SUFFIX = /-s(\d)$/;

/** Compose projects this repository owns. Anything else on the daemon is somebody else's. */
const QCMS_PROJECT_PREFIX = "qcms-";

/** The seat `project` encodes, or `undefined` when its name does not say. */
export function seatOfProject(project: string): number | undefined {
  if (!project.startsWith(QCMS_PROJECT_PREFIX)) return undefined;
  const matched = SEAT_SUFFIX.exec(project);
  if (matched === null) return 0;
  return Number(matched[1]);
}

/** Docker's own placeholder for a label a container does not carry. */
const EMPTY_LABEL = "<no value>";

/** A label value, or `undefined` when Docker reported it absent. */
function labelValue(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" || value === EMPTY_LABEL ? undefined : value;
}

/**
 * Turn `docker ps` output into a census.
 *
 * One line per running container: `name<TAB>testcontainers-session<TAB>compose-project`.
 * Parsed apart from the spawn so the shape can be tested without a daemon.
 *
 * The session COUNT is what the mid-suite symptom needs. One session is this run's own,
 * so "11 Testcontainers containers across 4 sessions" says three other lanes were
 * booting databases while this one's connection died, which is the fact the failure text
 * omits; a raw container count alone cannot separate a busy neighbourhood from one suite
 * that happens to use several containers.
 */
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

/** How long the census waits for the Docker CLI before giving up on it. */
const DOCKER_CENSUS_TIMEOUT_MS = 3_000;

/**
 * Where the Docker CLI may live, as absolute paths.
 *
 * Probed rather than resolved through `PATH`: launching a subprocess by bare name is
 * what `sonarjs/no-os-command-from-path` exists to stop, and the rule is workspace-wide.
 * Order is by likelihood on the platforms this harness runs on.
 */
const DOCKER_BINARY_CANDIDATES = [
  "/usr/bin/docker",
  "/usr/local/bin/docker",
  "/bin/docker",
  "/opt/homebrew/bin/docker",
];

/** The Docker CLI arguments the census runs. Exported so a test can pin the shape. */
export const DOCKER_CENSUS_ARGS: readonly string[] = [
  "ps",
  "--format",
  '{{.Names}}\t{{.Label "org.testcontainers.session-id"}}\t{{.Label "com.docker.compose.project"}}',
];

/** The two readings a snapshot is built from. Injectable so a test needs no host. */
export interface HostProbes {
  /** `docker ps` output, or `undefined` when the daemon could not be asked. */
  readonly dockerPs: () => string | undefined;
  /** `/proc/loadavg`'s contents, or `undefined` where there is no `/proc`. */
  readonly loadavg: () => string | undefined;
  /** Logical CPU count. */
  readonly cpus: () => number;
}

/**
 * One `docker ps`, with every failure swallowed.
 *
 * A diagnostic that can throw is a new way for a run to fail, which is the opposite of
 * the point: this only ever runs on a path that is already failing, and the error it is
 * annotating must survive it intact. `execFileSync` with a hard timeout, stderr
 * discarded, and a `undefined` for anything that goes wrong - including "there is no
 * Docker here", which is the honest answer on a machine where the daemon is what died.
 */
function probeDockerPs(): string | undefined {
  const binary = DOCKER_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (binary === undefined) return undefined;
  try {
    return execFileSync(binary, [...DOCKER_CENSUS_ARGS], {
      encoding: "utf8",
      timeout: DOCKER_CENSUS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/** `/proc/loadavg`, or `undefined` where it is not readable (macOS, Windows). */
function probeLoadAverage(): string | undefined {
  try {
    return readFileSync("/proc/loadavg", "utf8");
  } catch {
    return undefined;
  }
}

/** The real host, read once per call. */
export const HOST_PROBES: HostProbes = {
  dockerPs: probeDockerPs,
  loadavg: probeLoadAverage,
  cpus: availableParallelism,
};

/** Sample the machine now. */
export function sampleHost(probes: HostProbes = HOST_PROBES): HostSnapshot {
  const stdout = probes.dockerPs();
  return {
    load: parseLoadAverage(probes.loadavg(), probes.cpus()),
    daemon: stdout === undefined ? undefined : parseDaemonCensus(stdout),
  };
}

/** How the load half of the line reads. */
function describeLoad(load: HostLoadSample | undefined): string {
  if (load === undefined) return "load unknown (no /proc/loadavg)";
  const perCpu = (load.oneMinute / load.cpus).toFixed(2);
  return (
    `load ${load.oneMinute.toFixed(2)}/${load.fiveMinute.toFixed(2)}/${load.fifteenMinute.toFixed(2)}` +
    ` over ${String(load.cpus)} cpus (${perCpu} per cpu)`
  );
}

/** How one stack reads: its seat when the name gives one, its project name otherwise. */
function describeStack(stack: StackSample): string {
  return stack.seat === undefined ? stack.project : `seat ${String(stack.seat)} (${stack.project})`;
}

/** How the daemon half of the line reads. */
function describeDaemon(daemon: DaemonSample | undefined): string {
  if (daemon === undefined) return "docker unknown (the daemon could not be asked)";
  const containers =
    `docker ${String(daemon.running)} running, ${String(daemon.testcontainers)} Testcontainers` +
    ` across ${String(daemon.sessions)} session${daemon.sessions === 1 ? "" : "s"}`;
  const stacks =
    daemon.stacks.length === 0
      ? "no QCMS stacks"
      : `QCMS stacks ${daemon.stacks.map(describeStack).join(", ")}`;
  return `${containers}; ${stacks}`;
}

/** The prefix every snapshot line carries, so it is greppable in a wall of test output. */
export const HOST_SNAPSHOT_PREFIX = "  host:";

/**
 * The snapshot as one line.
 *
 * One line because it is appended to a failure message somebody is reading in a
 * scrolling test log, next to a stack trace: a block would be skipped and a paragraph
 * would bury the numbers. It states what was measured and stops - the issue number is
 * there so a reader who wants the argument can find it, and no sentence here tells them
 * what the measurement means for their red.
 */
export function formatHostSnapshot(snapshot: HostSnapshot): string {
  return `${HOST_SNAPSHOT_PREFIX} ${describeLoad(snapshot.load)}; ${describeDaemon(snapshot.daemon)} (issue #812: what the host was doing, not a cause)`;
}

/**
 * How long a sample is reused before the host is asked again.
 *
 * A failing suite can produce hundreds of these in a second - every query on a pool
 * whose backend went away rejects - and spawning a `docker ps` per rejection would turn
 * a diagnostic into a load source on the very machine it is measuring. One reading per
 * window is plenty: contention is a property of the minute, not of the millisecond, and
 * the whole cascade of failures shares one cause.
 */
export const HOST_SNAPSHOT_CACHE_MS = 5_000;

/** The last rendered line and when it was taken. */
let cached: { at: number; line: string } | undefined;

/**
 * The snapshot line, sampling at most once per {@link HOST_SNAPSHOT_CACHE_MS}.
 *
 * Never throws: a probe that fails renders as "unknown" and the caller's own error is
 * what surfaces.
 */
export function hostSnapshotLine(
  probes: HostProbes = HOST_PROBES,
  now: number = Date.now(),
): string {
  if (cached !== undefined && now - cached.at < HOST_SNAPSHOT_CACHE_MS) return cached.line;
  let line: string;
  try {
    line = formatHostSnapshot(sampleHost(probes));
  } catch {
    line = formatHostSnapshot({ load: undefined, daemon: undefined });
  }
  cached = { at: now, line };
  return line;
}

/** Drop the cached sample. For tests, which must not inherit another test's reading. */
export function resetHostSnapshotCache(): void {
  cached = undefined;
}
