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
 * ## When the daemon itself is the slow part
 *
 * The census asks the same daemon every lane is queuing containers on, so it slows down
 * with the machine it is measuring (issue #942: `docker ps` measured at 2.56 to 5.82
 * seconds at load 100 with 54 Testcontainers Postgres up). It keeps its hard ceiling
 * rather than waiting longer, because this only ever runs where something has already
 * failed, and it reports the overrun as a reading instead of as an absence: the load half
 * of the line is unchanged and the daemon half says the census was not answered in time.
 * That reading is then reused for longer than a cheap one, so a cascade of failures
 * cannot spend the ceiling over and over on a host that is already struggling.
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
  /**
   * What the census cost and whether it finished, `undefined` when none was attempted.
   *
   * Kept beside `daemon` rather than inside it because it is the reading that survives
   * when `daemon` does not: a census that ran out of time leaves no census to parse and
   * still says something about the machine (issue #942).
   */
  readonly census: DaemonCensusReading | undefined;
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

/**
 * How long the census waits for the Docker CLI before giving up on it.
 *
 * Deliberately not widened when issue #942 found the daemon outrunning it (2.56, 3.01,
 * 3.55, 4.91 and 5.82 seconds across five consecutive calls on a host at load 100 with 54
 * Testcontainers Postgres up). This runs on a path that is already failing, so every
 * millisecond added here is a millisecond added to a red run's report; the ceiling stays
 * where it is and the overrun is reported as the reading it is instead.
 */
export const DOCKER_CENSUS_TIMEOUT_MS = 3_000;

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
  /** One census attempt: `docker ps` output when it answered, and what it cost. */
  readonly dockerPs: () => DaemonCensusReading;
  /** `/proc/loadavg`'s contents, or `undefined` where there is no `/proc`. */
  readonly loadavg: () => string | undefined;
  /** Logical CPU count. */
  readonly cpus: () => number;
}

/**
 * One census attempt, and what it cost.
 *
 * The cost is part of the reading (issue #942). `docker ps` is a request to a daemon that
 * is carrying every container on the machine, so under the load this snapshot exists to
 * describe it slows down with everything else, and a census that ran out of time is not a
 * missing reading: it is a reading about the daemon. Before this it rendered as "the
 * daemon could not be asked", which is also what a machine with no Docker installed says,
 * so the one line written to tell a busy host from a broken one went quiet exactly when
 * the host was busiest.
 */
export interface DaemonCensusReading {
  /** `docker ps` output, or `undefined` when the daemon did not answer. */
  readonly stdout: string | undefined;
  /** How long the attempt took, wall clock, whether it answered or not. */
  readonly elapsedMs: number;
  /** True when the attempt was cut off at its ceiling rather than failing outright. */
  readonly timedOut: boolean;
}

/**
 * Run one census command under a hard ceiling, with every failure swallowed.
 *
 * A diagnostic that can throw is a new way for a run to fail, which is the opposite of
 * the point: this only ever runs on a path that is already failing, and the error it is
 * annotating must survive it intact. So `execFileSync` with a hard timeout, stderr
 * discarded, and a degraded reading for anything that goes wrong - including "there is no
 * Docker here", which is the honest answer on a machine where the daemon is what died.
 *
 * Exported for the test that pins that degrade path. Pointed at a command that
 * deliberately outlives its ceiling, it proves the overrun is reported as one, with no
 * daemon involved and without loading the machine to provoke a slow one - which would be
 * a test that caused the condition it was measuring.
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
    // Node kills the child at the ceiling and reports `ETIMEDOUT`. The elapsed comparison
    // is the belt for a platform that words it differently: a call that lasted the whole
    // budget reached the budget, whatever the error it threw says about it.
    const code = (cause as { code?: unknown }).code;
    return {
      stdout: undefined,
      elapsedMs,
      timedOut: code === "ETIMEDOUT" || elapsedMs >= timeoutMs,
    };
  }
}

/** One `docker ps` against the real daemon, or a degraded reading saying why not. */
function probeDockerPs(): DaemonCensusReading {
  const binary = DOCKER_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  // No elapsed time worth reporting: nothing was asked, because there is nothing to ask.
  if (binary === undefined) return { stdout: undefined, elapsedMs: 0, timedOut: false };
  return runDockerCensus(binary, DOCKER_CENSUS_ARGS, DOCKER_CENSUS_TIMEOUT_MS);
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
  const census = probes.dockerPs();
  return {
    load: parseLoadAverage(probes.loadavg(), probes.cpus()),
    daemon: census.stdout === undefined ? undefined : parseDaemonCensus(census.stdout),
    census,
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

/**
 * How a census that produced nothing reads.
 *
 * The two cases are kept apart deliberately (issue #942). "There is no Docker on this
 * machine" and "the daemon was too busy to answer in three seconds" are opposite facts
 * about a host, and collapsing them into one sentence made the snapshot silent under
 * precisely the load it was written to describe. A stated overrun is a partial snapshot:
 * the load half is still there, and the daemon half says what was tried and for how long.
 */
function describeMissingCensus(census: DaemonCensusReading | undefined): string {
  if (census?.timedOut !== true) return "docker unknown (the daemon could not be asked)";
  return `docker unknown (the daemon did not answer the census within ${String(census.elapsedMs)}ms)`;
}

/** How long the census took, when that is known. */
function describeCensusCost(census: DaemonCensusReading | undefined): string {
  return census === undefined ? "" : ` in ${String(census.elapsedMs)}ms`;
}

/** How the daemon half of the line reads. */
function describeDaemon(
  daemon: DaemonSample | undefined,
  census: DaemonCensusReading | undefined,
): string {
  if (daemon === undefined) return describeMissingCensus(census);
  // The cost rides along even when the census succeeded: a daemon that answered in 2.9
  // seconds is a loaded daemon, and that is the same signal one slow tick earlier.
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
  return `${HOST_SNAPSHOT_PREFIX} ${describeLoad(snapshot.load)}; ${describeDaemon(snapshot.daemon, snapshot.census)} (issue #812: what the host was doing, not a cause)`;
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

/**
 * How long a snapshot whose census timed out is reused before the daemon is asked again.
 *
 * The ordinary window assumes a census is cheap, and on a host that is answering it is
 * (0.12 to 0.21 s measured idle). A census that hit its ceiling cost the whole ceiling,
 * and re-paying that every five seconds through a cascade of failures is how a diagnostic
 * starts spending a test's own budget - on the one host that can least afford it (issue
 * #942). A daemon that could not answer in three seconds will not have become interesting
 * five seconds later, and the line already says what it says.
 */
export const HOST_SNAPSHOT_SLOW_CENSUS_CACHE_MS = 30_000;

/** The last rendered line, when it was taken, and how long it may stand. */
let cached: { at: number; line: string; window: number } | undefined;

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

/** Drop the cached sample. For tests, which must not inherit another test's reading. */
export function resetHostSnapshotCache(): void {
  cached = undefined;
}
