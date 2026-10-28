/**
 * How busy this machine is, and whether that is enough to doubt a red run: the load
 * averages, the Docker containers running and how many Testcontainers sessions they
 * span.
 *
 * It is evidence rather than a verdict. Nothing here retries, skips or relaxes anything;
 * it gives a reader the one thing a failure message cannot, which is what else was
 * happening at the time.
 *
 * The Docker CLI is looked for at absolute paths, because a daemon that cannot be
 * reached has to read as unknown rather than as idle.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

/** The host's run-queue pressure, as the kernel reports it. */
export interface HostLoad {
  readonly oneMinute: number;
  readonly fiveMinute: number;
  readonly fifteenMinute: number;
  /** Logical CPUs, so a load figure can be read as a ratio rather than a magnitude. */
  readonly cpus: number;
}

/** What the shared Docker daemon was carrying. */
export interface ContainerCensus {
  /** Every running container the daemon reports, this run's own included. */
  readonly running: number;
  /** Of those, how many carry a Testcontainers session label. */
  readonly testcontainers: number;
  /**
   * How many DISTINCT Testcontainers sessions those containers span.
   *
   * The one number that sees a lane holding no seat ports. Every process that boots a
   * Testcontainers container gets a session id and stamps it on everything it starts,
   * this run's own containers included, so two sessions means two lanes whatever either
   * of them is running - a `turbo run test` leaves no other trace a browser suite can
   * observe (issue #395's second occurrence).
   */
  readonly sessions: number;
  /** Of those, how many belong to a QCMS Compose stack (`qcms-` prefixed). */
  readonly qcmsStacks: number;
}

/**
 * Parse `/proc/loadavg`'s three averages.
 *
 * Split out from the read so the parse is testable without a kernel: the file's first
 * three fields are the one, five and fifteen minute averages, and anything that does not
 * produce three finite numbers is reported as "unknown" rather than as zero. Zero is a
 * real, meaningful load figure, and a parse failure that renders as one would read as
 * "the machine was idle" in exactly the report someone is using to decide whether it was.
 */
export function parseLoadAverage(text: string, cpus: number): HostLoad | undefined {
  const fields = text.trim().split(/\s+/).slice(0, 3).map(Number);
  if (fields.length < 3 || fields.some((value) => !Number.isFinite(value))) return undefined;
  const [oneMinute, fiveMinute, fifteenMinute] = fields as [number, number, number];
  return { oneMinute, fiveMinute, fifteenMinute, cpus };
}

/** The host's load right now, or `undefined` where `/proc/loadavg` is not readable. */
export function hostLoad(): HostLoad | undefined {
  try {
    return parseLoadAverage(readFileSync("/proc/loadavg", "utf8"), availableParallelism());
  } catch {
    return undefined;
  }
}

/** How long the container census waits for the Docker CLI before giving up. */
const DOCKER_CENSUS_TIMEOUT_MS = 5_000;

/**
 * Where the Docker CLI may live, as absolute paths.
 *
 * Probed rather than resolved through `PATH`, the way `scripts/docker-host.mjs` probes for
 * `ip`: launching a subprocess by bare name is what `sonarjs/no-os-command-from-path`
 * exists to stop, and the rule is workspace-wide. Order is by likelihood on the platforms
 * this harness runs on - Debian and Ubuntu first, since that is the dev container, then
 * the two paths a macOS install uses.
 */
const DOCKER_BINARY_CANDIDATES = [
  "/usr/bin/docker",
  "/usr/local/bin/docker",
  "/bin/docker",
  "/opt/homebrew/bin/docker",
];

/** The first candidate that exists, or `undefined` when Docker is not installed here. */
function dockerBinary(): string | undefined {
  return DOCKER_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
}

/**
 * Turn `docker ps` output into a census.
 *
 * One line per running container, tab-separated as `name<TAB>session-id`, where the
 * session id is Testcontainers' own label and is empty for everything else. Parsed
 * separately from the spawn so the shape can be tested without a daemon.
 */
export function parseContainerCensus(stdout: string): ContainerCensus {
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  const sessions = new Set<string>();
  let testcontainers = 0;
  let qcmsStacks = 0;
  for (const line of lines) {
    const [name = "", sessionId = ""] = line.split("\t");
    const session = sessionId.trim();
    if (session !== "" && session !== "<no value>") {
      testcontainers += 1;
      sessions.add(session);
    }
    if (name.startsWith("qcms-")) qcmsStacks += 1;
  }
  return { running: lines.length, testcontainers, sessions: sessions.size, qcmsStacks };
}

/**
 * What the Docker daemon is running, or `undefined` when it cannot be asked.
 *
 * The daemon is the resource the seat scheme does not partition, so its occupancy is the
 * number this report exists to carry. `spawnSync` with a hard timeout and every failure
 * swallowed: a census that hangs or throws would convert a diagnostic into a new way for
 * a run to fail, which is the opposite of the point.
 */
export function containerCensus(): ContainerCensus | undefined {
  const binary = dockerBinary();
  if (binary === undefined) return undefined;
  try {
    const probed = spawnSync(
      binary,
      ["ps", "--format", '{{.Names}}\t{{.Label "org.testcontainers.session-id"}}'],
      { encoding: "utf8", timeout: DOCKER_CENSUS_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] },
    );
    if (probed.status !== 0 || typeof probed.stdout !== "string") return undefined;
    return parseContainerCensus(probed.stdout);
  } catch {
    return undefined;
  }
}

/** How the load figure reads in a report. */
export function describeLoad(load: HostLoad | undefined): string {
  if (load === undefined) return "unknown (no /proc/loadavg)";
  const ratio = (load.oneMinute / load.cpus).toFixed(2);
  return (
    `${load.oneMinute.toFixed(2)} / ${load.fiveMinute.toFixed(2)} / ` +
    `${load.fifteenMinute.toFixed(2)} over ${String(load.cpus)} cpus (1m load is ${ratio} per cpu)`
  );
}

/** How the container census reads in a report. */
export function describeContainers(census: ContainerCensus | undefined): string {
  if (census === undefined) return "unknown (docker could not be asked)";
  return (
    `${String(census.running)} running, of which ${String(census.testcontainers)} ` +
    `Testcontainers across ${String(census.sessions)} session${census.sessions === 1 ? "" : "s"} ` +
    `and ${String(census.qcmsStacks)} QCMS Compose`
  );
}

/**
 * How many Testcontainers sessions on the daemon are not this run's.
 *
 * At most one session belongs to this run, whether or not it has booted a container yet,
 * so subtracting one is the conservative reading: it can under-report a neighbour (when
 * this run has started nothing), never invent one.
 */
export function foreignSessions(census: ContainerCensus | undefined): number {
  if (census === undefined) return 0;
  return Math.max(0, census.sessions - 1);
}

/**
 * Where a run queue stops being "the machine is working" and starts being "the machine is
 * oversubscribed", as a multiple of the CPU count.
 *
 * Two per CPU rather than one: a passing browser suite with its dev servers, its API and
 * a Postgres container routinely sits around one, so a threshold there would fire on
 * every healthy run and teach a reader to skip the block. Two is where the waves 11 to 13
 * failures were measured, and the cost of the threshold being slightly wrong is
 * asymmetric - an extra paragraph on a red, against a missing one.
 */
export const LOAD_PRESSURE_PER_CPU = 2;

/** Everything about the machine that could explain a red that this branch cannot. */
export interface HostPressure {
  /** One phrase per reason, ready to print. Empty when the machine looked quiet. */
  readonly reasons: readonly string[];
}

/**
 * What, if anything, about this machine argues that a red might not be the branch's own.
 *
 * Deliberately narrow. Only two things qualify: another lane's Testcontainers session on
 * the shared daemon, and a run queue well past the CPU count. Both are facts about the
 * host that the seat scheme does not partition and that no diff can cause.
 */
export function hostPressure(
  load: HostLoad | undefined,
  census: ContainerCensus | undefined,
): HostPressure {
  const reasons: string[] = [];
  const foreign = foreignSessions(census);
  if (foreign > 0 && census !== undefined) {
    reasons.push(
      `${String(census.sessions)} Testcontainers sessions on the shared daemon ` +
        `(${String(foreign)} of them not this run's), ${String(census.testcontainers)} containers between them`,
    );
  }
  if (load !== undefined && load.oneMinute >= load.cpus * LOAD_PRESSURE_PER_CPU) {
    reasons.push(
      `1m load ${load.oneMinute.toFixed(2)} over ${String(load.cpus)} cpus ` +
        `(${(load.oneMinute / load.cpus).toFixed(2)} per cpu, at or past ${String(LOAD_PRESSURE_PER_CPU)})`,
    );
  }
  return { reasons };
}

/**
 * The machine on one line, for a message that has room for one line.
 *
 * The seat refusal uses this: it already prints who holds the port, and the question it
 * cannot otherwise answer is whether picking another seat will help or whether the
 * machine is simply full.
 */
export function renderHostLine(
  load: HostLoad | undefined = hostLoad(),
  census: ContainerCensus | undefined = containerCensus(),
): string {
  return `host: load ${describeLoad(load)}; containers ${describeContainers(census)}`;
}

/** The memoised line, so a process spawns at most one `docker ps` however often it asks. */
let sampledLine: string | undefined;

/**
 * {@link renderHostLine}, sampled at most once per process.
 *
 * The caller is the seat refusal, which throws immediately afterwards, so one reading is
 * all the information there is to have - and a `docker ps` per refused port would be
 * several spawns for one answer. Memoising also keeps the unit suite honest: the tests
 * that exercise the refusal pay for one probe between them rather than one each.
 */
export function hostLineOnce(): string {
  sampledLine ??= renderHostLine();
  return sampledLine;
}
