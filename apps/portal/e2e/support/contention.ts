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
 *
 * ## The machine probe lives next door
 *
 * `/proc/loadavg` and the `docker ps` census are in `host-pressure.ts`, not here. The seat
 * refusal in `port-seat.ts` prints the same reading when it refuses a seat, and this module
 * reads `/proc` through that same file, so leaving the probe here would make the pair
 * circular. What stayed is everything specific to the REPORT: which failures are
 * contention-shaped, which neighbouring seats were live, and the prose.
 */

import {
  HARNESS_SERVICES,
  MAX_PORT_SEAT,
  MIN_PORT_SEAT,
  harnessPorts,
} from "../../../../scripts/ports.mjs";

import {
  containerCensus,
  describeContainers,
  describeLoad,
  hostLoad,
  hostPressure,
  type ContainerCensus,
  type HostLoad,
} from "./host-pressure.js";
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

/** One sample of the machine around this run. */
export interface HostSnapshot {
  readonly at: string;
  readonly load: HostLoad | undefined;
  readonly neighbours: readonly NeighbourStack[];
  readonly containers: ContainerCensus | undefined;
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
    // `Module not found: Can't resolve '@roonga/qcms-ui/fonts'` and the server-log gate reds a
    // spec that touched nothing. It is a build racing a running server, not a defect, and
    // it is invisible to every network-shaped signature above.
    name: "workspace rebuild",
    pattern: /Module not found: Can't resolve '@roonga\/qcms-/i,
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

/** Which of the run's two samples saw a neighbour. */
export type NeighbourPresence = "start" | "end" | "both";

/** A neighbour, plus when it was observed. */
export interface ObservedNeighbour extends NeighbourStack {
  readonly seenAt: NeighbourPresence;
}

/** One key per listening port, which is what makes the two samples comparable. */
function neighbourKey(stack: NeighbourStack): string {
  return `${String(stack.seat)}:${stack.service}:${String(stack.port)}`;
}

/**
 * Every neighbour seen at either end of the run, tagged with which samples saw it.
 *
 * The report's header counts the UNION of the two samples, so the detail lines have to be
 * the union too. They were not: they rendered the start sample and fell back to the end one
 * only when start was empty, so a lane that arrived mid-run - while another was already
 * there - was counted in the header and then missing from the list underneath it. In a
 * report whose entire purpose is to be trusted about what else was on the machine, an
 * internally inconsistent one is worse than none.
 *
 * The tag is kept because the asymmetry is the interesting part: a neighbour that arrived
 * partway through is a different story from one that was there all along, and a reader
 * chasing a red wants to know which.
 */
export function mergeNeighbours(
  start: readonly NeighbourStack[],
  end: readonly NeighbourStack[],
): ObservedNeighbour[] {
  const merged = new Map<string, ObservedNeighbour>();
  for (const stack of start) merged.set(neighbourKey(stack), { ...stack, seenAt: "start" });
  for (const stack of end) {
    const key = neighbourKey(stack);
    const already = merged.get(key);
    merged.set(
      key,
      already === undefined ? { ...stack, seenAt: "end" } : { ...already, seenAt: "both" },
    );
  }
  return [...merged.values()].sort((a, b) => a.seat - b.seat || a.port - b.port);
}

/**
 * How a neighbour's observation window reads, or `""` when it needs no comment.
 *
 * A neighbour present in both samples is the unremarkable case and is left untagged; the
 * two asymmetric cases are the ones that carry information, so only they are named.
 */
function describePresence(seenAt: NeighbourPresence | undefined): string {
  if (seenAt === "start") return " [gone by the end of the run]";
  if (seenAt === "end") return " [arrived during the run]";
  return "";
}

/**
 * Neighbouring seats, deduplicated and ordered, as they read in the report.
 *
 * Accepts plain stacks (the start notice, which has only one sample and nothing to tag) or
 * merged ones (the end-of-run report, where the tag says which sample saw each).
 */
export function describeNeighbours(
  neighbours: readonly (NeighbourStack | ObservedNeighbour)[],
): string[] {
  const bySeat = new Map<number, (NeighbourStack | ObservedNeighbour)[]>();
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
            (stack.pid === undefined
              ? ""
              : ` (pid ${String(stack.pid)}, cwd ${stack.cwd ?? "?"})`) +
            describePresence("seenAt" in stack ? stack.seenAt : undefined),
        )
        .join(", ");
      return `  - seat ${String(seat)}: ${where}`;
    });
}

/**
 * The notice printed at run start when this run does not have the machine to itself.
 *
 * Two ways not to have it, and the notice says which. A live harness port on another seat
 * names a sibling browser lane; host pressure names a machine carrying other work that
 * holds no seat port at all, which is the shape #395's second occurrence had. Printed at
 * the START because it is the only point where the information can still save the run:
 * fifteen minutes before the red, a reader can decide to wait.
 */
export function renderStartNotice(
  seat: number,
  neighbours: readonly NeighbourStack[],
  pressure: readonly string[] = [],
): string {
  const seats = [...new Set(neighbours.map((stack) => stack.seat))].sort((a, b) => a - b);
  return [
    seats.length > 0
      ? `[contention] seat ${String(seat)} is NOT alone: harness ports are live on ` +
        `seat${seats.length === 1 ? "" : "s"} ${seats.join(", ")}.`
      : `[contention] seat ${String(seat)} holds its own ports, but this machine is NOT quiet.`,
    "[contention] Ports are partitioned per seat, the Docker daemon and the CPU are not.",
    "[contention] A red run here may not be this branch's own; the end-of-run report says what was live.",
    ...describeNeighbours(neighbours).map((line) => `[contention]${line}`),
    ...pressure.map((reason) => `[contention]  - ${reason}`),
  ].join("\n");
}

/**
 * Everything about the machine, at either end of the run, that a red cannot be explained
 * away without.
 *
 * The union of the two samples rather than either one, and for the same reason the
 * neighbour list is a union: a lane that arrived mid-run is exactly the case this is
 * supposed to catch, and a report that read only the start sample would miss it.
 */
function pressureReasons(start: HostSnapshot, end: HostSnapshot): string[] {
  const atStart = hostPressure(start.load, start.containers).reasons;
  const atEnd = hostPressure(end.load, end.containers).reasons;
  const seen = new Set([...atStart, ...atEnd]);
  return [...seen].map((reason) => {
    // The same three labels the neighbour list uses, and for the same reason: a reading
    // that held all the way through is a different story from one that only appeared while
    // the suite was running, and a reader chasing a red wants to know which.
    const when =
      atStart.includes(reason) && atEnd.includes(reason)
        ? "throughout"
        : atStart.includes(reason)
          ? "at start"
          : "at end";
    return `  - ${when}: ${reason}`;
  });
}

/**
 * The end-of-run block, printed only when the run has failures.
 *
 * It states what was measured and stops there. The closing sentence is the whole point of
 * the issue: it tells the reader that a bisect is cheap and believing the red is not, and
 * it says so with the numbers attached rather than as generic advice.
 *
 * ## The second branch, and why the first one was not enough
 *
 * The original report had two outcomes: a neighbouring seat was named, or the reader was
 * told that nothing argued against reading the failures as their own. The second outcome
 * turned out to be wrong in exactly the case that cost the most. #395's follow-up
 * occurrence was a forced unit run that failed two packages an admin-only diff cannot
 * reach, and the lanes competing with it were running `turbo run test`: no browser
 * harness, no seat ports, nothing for `neighbourStacks` to find, while eleven Postgres
 * containers from other sessions were queued on the one daemon. The report would have
 * printed "nothing here argues against reading these failures as this branch's own" over
 * the most contended machine of the night.
 *
 * So a run is "not alone" when a neighbour is named OR when the host itself was under
 * pressure, which is read from the daemon's Testcontainers sessions and the run queue -
 * both facts about the machine that no diff can cause and that the seat scheme does not
 * partition. The quiet-machine wording is now reached only when the machine really was
 * quiet, which is the only condition under which it was ever true.
 */
export function renderContentionReport(report: ContentionReport): string {
  const { seat, start, end, failures } = report;
  const annotated = failures.filter((failure) => failure.signature !== undefined);
  // One merged list, and the header counts derived FROM it, so the summary line and the
  // detail lines under it can never disagree about who was there.
  const neighbours = mergeNeighbours(start.neighbours, end.neighbours);
  const neighbourSeats = [...new Set(neighbours.map((stack) => stack.seat))].sort((a, b) => a - b);
  const pressure = pressureReasons(start, end);

  const lines = [
    "",
    "=== cross-lane contention report (issue #395) ===",
    `seat ${String(seat)}, ${String(failures.length)} failing test${failures.length === 1 ? "" : "s"}`,
    `host load at start: ${describeLoad(start.load)}`,
    `host load at end:   ${describeLoad(end.load)}`,
    `containers at start: ${describeContainers(start.containers)}`,
    `containers at end:   ${describeContainers(end.containers)}`,
  ];

  if (neighbourSeats.length === 0 && pressure.length > 0) {
    lines.push(
      "other seats' harness ports: none occupied at start or end.",
      "No neighbouring browser harness held a seat port - AND THE MACHINE WAS NOT QUIET:",
      ...pressure,
      "A lane running unit or Docker-backed tests holds no seat port at all, so the absence",
      "of a seat collision is not evidence that this run had the machine to itself.",
    );
  } else if (neighbourSeats.length === 0) {
    lines.push(
      "other seats' harness ports: none occupied at start or end.",
      "No neighbouring browser harness was detected and the host looked quiet, so nothing",
      "here argues against reading these failures as this branch's own.",
    );
  } else {
    lines.push(
      `other seats' harness ports: OCCUPIED on seat${neighbourSeats.length === 1 ? "" : "s"} ` +
        `${neighbourSeats.join(", ")}.`,
      ...describeNeighbours(neighbours),
      ...(pressure.length === 0 ? [] : ["and the host itself was under pressure:", ...pressure]),
    );
  }

  if (annotated.length > 0) {
    lines.push(
      "",
      `${String(annotated.length)} of ${String(failures.length)} failures match a resource-contention shape:`,
      ...annotated.map((failure) => `  - ${failure.title}: ${failure.signature ?? ""}`),
    );
  }

  const suspect = neighbourSeats.length > 0 || pressure.length > 0 || annotated.length > 0;
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
