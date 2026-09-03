/**
 * What else was running on this machine while the browser suite ran (issue #395).
 *
 * ## The failure this exists for
 *
 * A `verify:browser` run on one seat came back with eight failures and 65 tests never
 * run, every failure the FIRST test of an admin spec, all of them at sign-in, on a diff
 * of three visually-hidden paragraphs and five strings. The seat guard had done its job:
 * no port was shared and no collision was reported. Another lane was simply running
 * gates at the same time, against the same Docker daemon, and the run went red for that
 * reason while presenting as an ordinary regression in the auth path. It cost a bisect,
 * and it was only bisected because the red happened to be implausible enough to doubt.
 *
 * The seat scheme partitions **ports**. It does not partition the Docker daemon, the CPU
 * or the page cache, and nothing told the lane that its red might not be its own. That is
 * a gate-integrity problem rather than a flake: a red browser suite is a merge gate, and
 * under parallelism it can be entirely caused by a neighbour.
 *
 * ## What this module does, and what it deliberately does not
 *
 * It **attributes**, it never excuses. Every function here is read-only: it samples the
 * host at run start and again at run end, it labels a failure's text against a list of
 * signatures that resource contention produces, and it hands the caller a block of prose
 * to print. Nothing it returns can change a verdict, mark a test flaky, retry anything, or
 * turn a red into a green. A run that fails still fails, with the same exit code and the
 * same failure list; it just no longer fails silently about the company it was keeping.
 *
 * The judgement stays with the reader on purpose. "Another seat's stack was live and four
 * of your failures are connection refusals" is a fact worth putting in front of someone;
 * "therefore this red is not yours" is a conclusion only they can draw, because a genuine
 * regression and a contention red can hold that shape at the same time.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";

import {
  HARNESS_SERVICES,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  harnessPorts,
} from "../../../../scripts/ports.mjs";

import { occupantOfPort } from "./port-seat.js";

/** A harness service that takes a port from a seat's `17Sxx` block. */
type HarnessService = keyof typeof HARNESS_SERVICES;

/** One of another seat's harness ports, found occupied while this run was going. */
export interface NeighbourStack {
  readonly seat: number;
  readonly service: HarnessService;
  readonly port: number;
  /** The listening process, when `/proc` could identify it. */
  readonly pid: number | undefined;
  /** That process's working directory, which on a dev server is its worktree. */
  readonly cwd: string | undefined;
}

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
  /** Of those, how many belong to a QCMS Compose stack (`qcms-` prefixed). */
  readonly qcmsStacks: number;
}

/** One sample of the machine around this run. */
export interface HostSnapshot {
  readonly at: string;
  readonly load: HostLoad | undefined;
  readonly neighbours: readonly NeighbourStack[];
  readonly containers: ContainerCensus | undefined;
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

/** Every seat except `selfSeat`, in order. Exported so the sweep is testable. */
export function otherSeats(selfSeat: number): number[] {
  const seats: number[] = [];
  for (let seat = MIN_PORT_SEAT; seat <= MAX_PORT_SEAT; seat += 1) {
    if (seat !== selfSeat) seats.push(seat);
  }
  return seats;
}

/** How the reporter looks up who holds a port. Injectable so tests need no listener. */
export type OccupantLookup = (
  port: number,
) => { pid: number | undefined; cwd: string | undefined } | undefined;

/**
 * Every OTHER seat's harness port that has a listener right now.
 *
 * This is the one signal that names a neighbouring **lane** rather than generic load: a
 * listener on seat 3's admin port is another browser harness, and the only thing that
 * puts one there is somebody else's run. It is read from the same `/proc` tables the seat
 * preflight already reads, so it adds no new mechanism, and it is a plain observation
 * rather than a refusal: this run's own ports are none of its business and are skipped.
 */
export function neighbourStacks(
  selfSeat: number,
  occupantOf: OccupantLookup = occupantOfPort,
): NeighbourStack[] {
  const found: NeighbourStack[] = [];
  for (const seat of otherSeats(selfSeat)) {
    for (const { service, port } of harnessPorts(seat)) {
      const occupant = occupantOf(port);
      if (occupant === undefined) continue;
      found.push({ seat, service, port, pid: occupant.pid, cwd: occupant.cwd });
    }
  }
  return found;
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
  let testcontainers = 0;
  let qcmsStacks = 0;
  for (const line of lines) {
    const [name = "", sessionId = ""] = line.split("\t");
    if (sessionId.trim() !== "" && sessionId.trim() !== "<no value>") testcontainers += 1;
    if (name.startsWith("qcms-")) qcmsStacks += 1;
  }
  return { running: lines.length, testcontainers, qcmsStacks };
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

/** One sample of the machine, taken now. */
export function snapshotHost(selfSeat: number): HostSnapshot {
  return {
    at: new Date().toISOString(),
    load: hostLoad(),
    neighbours: neighbourStacks(selfSeat),
    containers: containerCensus(),
  };
}

/**
 * Failure texts that resource contention produces, and what each one means.
 *
 * Every entry is a shape a run gets when something it depends on was too busy or too slow
 * to answer, never a shape that only an application defect produces. That distinction is
 * what keeps the annotation honest: a matched signature says "this failure is the kind
 * contention causes", which is a claim about the failure's SHAPE, and it is deliberately
 * not the claim that contention caused it. A real regression can refuse a connection too.
 */
export const CONTENTION_SIGNATURES: readonly {
  readonly name: string;
  readonly pattern: RegExp;
  readonly why: string;
}[] = [
  {
    name: "connection refused",
    // `ERR_CONNECTION_REFUSED` (Chromium's net error) and `connection refused` (a
    // socket's own wording) are the same event with different separators, so the
    // character class covers both rather than letting the net-error form fall through to
    // the vaguer navigation signature below.
    pattern: /ECONNREFUSED|connect(?:ion)?[ _]refused/i,
    why: "nothing was listening where a dependency should have been",
  },
  {
    name: "connection dropped",
    pattern: /ECONNRESET|EPIPE|socket hang up/i,
    why: "a dependency accepted the connection and then dropped it",
  },
  {
    name: "boot timeout",
    pattern: /Timed out waiting \d+ms from config\.webServer|waiting for the web server/i,
    why: "a dev server did not reach readiness inside its startup budget",
  },
  {
    name: "container startup",
    pattern: /Testcontainers|docker(?:ode)?|Could not (?:find|start) a valid Docker/i,
    why: "the shared Docker daemon did not deliver a container in time",
  },
  {
    // Added from a live incident rather than from imagination. A forced turbo run in the
    // same tree deletes and rewrites every package's `dist/` (`scripts/clean-dist.mjs`
    // then `tsc`), and a `next dev` server serving that tree resolves imports at request
    // time, so for the seconds the directory is missing the dev server answers
    // `Module not found: Can't resolve '@qcms/ui/fonts'` and the server-log gate reds a
    // spec that touched nothing. It is a build racing a running server, not a defect, and
    // it is invisible to every network-shaped signature above.
    name: "workspace rebuild",
    pattern: /Module not found: Can't resolve '@qcms\//i,
    why: "a concurrent build replaced a workspace package under a running dev server",
  },
  {
    name: "navigation timeout",
    pattern: /page\.goto|waiting for navigation|net::ERR_(?:CONNECTION|EMPTY_RESPONSE|TIMED_OUT)/i,
    why: "a page never arrived from a server that should have served it",
  },
];

/** Which contention signature `text` matches, if any. */
export function classifyFailure(text: string): string | undefined {
  return CONTENTION_SIGNATURES.find((signature) => signature.pattern.test(text))?.name;
}

/** One failed test, reduced to what the report needs. */
export interface FailureNote {
  readonly title: string;
  /** The contention signature its error text matched, when it matched one. */
  readonly signature: string | undefined;
}

/** Everything the report is rendered from. */
export interface ContentionReport {
  readonly seat: number;
  readonly start: HostSnapshot;
  readonly end: HostSnapshot;
  readonly failures: readonly FailureNote[];
}

function describeLoad(load: HostLoad | undefined): string {
  if (load === undefined) return "unknown (no /proc/loadavg)";
  const ratio = (load.oneMinute / load.cpus).toFixed(2);
  return (
    `${load.oneMinute.toFixed(2)} / ${load.fiveMinute.toFixed(2)} / ` +
    `${load.fifteenMinute.toFixed(2)} over ${String(load.cpus)} cpus (1m load is ${ratio} per cpu)`
  );
}

function describeContainers(census: ContainerCensus | undefined): string {
  if (census === undefined) return "unknown (docker could not be asked)";
  return (
    `${String(census.running)} running, of which ${String(census.testcontainers)} ` +
    `Testcontainers and ${String(census.qcmsStacks)} QCMS Compose`
  );
}

/** Neighbouring seats, deduplicated and ordered, as they read in the report. */
export function describeNeighbours(neighbours: readonly NeighbourStack[]): string[] {
  const bySeat = new Map<number, NeighbourStack[]>();
  for (const stack of neighbours) {
    const existing = bySeat.get(stack.seat);
    if (existing === undefined) bySeat.set(stack.seat, [stack]);
    else existing.push(stack);
  }
  return [...bySeat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seat, stacks]) => {
      const where = stacks
        .map(
          (stack) =>
            `${stack.service} ${String(stack.port)}` +
            (stack.pid === undefined ? "" : ` (pid ${String(stack.pid)}, cwd ${stack.cwd ?? "?"})`),
        )
        .join(", ");
      return `  - seat ${String(seat)}: ${where}`;
    });
}

/** The one-line notice printed at run start when another lane is already up. */
export function renderStartNotice(seat: number, neighbours: readonly NeighbourStack[]): string {
  const seats = [...new Set(neighbours.map((stack) => stack.seat))].sort((a, b) => a - b);
  return [
    `[contention] seat ${String(seat)} is NOT alone: harness ports are live on ` +
      `seat${seats.length === 1 ? "" : "s"} ${seats.join(", ")}.`,
    "[contention] Ports are partitioned per seat, the Docker daemon and the CPU are not.",
    "[contention] A red run here may not be this branch's own; the end-of-run report says what was live.",
    ...describeNeighbours(neighbours).map((line) => `[contention]${line}`),
  ].join("\n");
}

/**
 * The end-of-run block, printed only when the run has failures.
 *
 * It states what was measured and stops there. The closing sentence is the whole point of
 * the issue: it tells the reader that a bisect is cheap and believing the red is not, and
 * it says so with the numbers attached rather than as generic advice.
 */
export function renderContentionReport(report: ContentionReport): string {
  const { seat, start, end, failures } = report;
  const annotated = failures.filter((failure) => failure.signature !== undefined);
  const neighbourSeats = [
    ...new Set([...start.neighbours, ...end.neighbours].map((stack) => stack.seat)),
  ].sort((a, b) => a - b);

  const lines = [
    "",
    "=== cross-lane contention report (issue #395) ===",
    `seat ${String(seat)}, ${String(failures.length)} failing test${failures.length === 1 ? "" : "s"}`,
    `host load at start: ${describeLoad(start.load)}`,
    `host load at end:   ${describeLoad(end.load)}`,
    `containers at start: ${describeContainers(start.containers)}`,
    `containers at end:   ${describeContainers(end.containers)}`,
  ];

  if (neighbourSeats.length === 0) {
    lines.push(
      "other seats' harness ports: none occupied at start or end.",
      "No neighbouring browser harness was detected, so nothing here argues against",
      "reading these failures as this branch's own.",
    );
  } else {
    lines.push(
      `other seats' harness ports: OCCUPIED on seat${neighbourSeats.length === 1 ? "" : "s"} ` +
        `${neighbourSeats.join(", ")}.`,
      ...describeNeighbours(start.neighbours.length > 0 ? start.neighbours : end.neighbours),
    );
  }

  if (annotated.length > 0) {
    lines.push(
      "",
      `${String(annotated.length)} of ${String(failures.length)} failures match a resource-contention shape:`,
      ...annotated.map((failure) => `  - ${failure.title}: ${failure.signature ?? ""}`),
    );
  }

  const suspect = neighbourSeats.length > 0 || annotated.length > 0;
  lines.push(
    "",
    suspect
      ? "This run was not alone. Before treating these failures as a regression, re-run them on a"
      : "Nothing above suggests a neighbour. Treat these failures as this branch's own until",
    suspect
      ? "quiet machine: a false red costs a bisect, and a bisect is cheaper than a fix for a defect"
      : "something specific says otherwise.",
    ...(suspect
      ? ["that was never there. Nothing here has changed the verdict: the run still failed."]
      : []),
    "=== end contention report ===",
    "",
  );
  return lines.join("\n");
}
