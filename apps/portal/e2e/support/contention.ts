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

export const CONTENTION_SIGNATURES: readonly {
  readonly name: string;
  readonly pattern: RegExp;
  readonly why: string;
}[] = [
  {
    name: "connection refused",
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

export function renderStartNotice(
  seat: number,
  neighbours: readonly NeighbourStack[],
  pressure: readonly string[] = [],
): string {
  const seats = [...new Set(neighbours.map((stack) => stack.seat))].sort((a, b) => a - b);
  const plural = seats.length === 1 ? "" : "s";
  return [
    seats.length > 0
      ? `[contention] seat ${String(seat)} is NOT alone: harness ports are live on ` +
        `seat${plural} ${seats.join(", ")}.`
      : `[contention] seat ${String(seat)} holds its own ports, but this machine is NOT quiet.`,
    "[contention] Ports are partitioned per seat, the Docker daemon and the CPU are not.",
    "[contention] A red run here may not be this branch's own; the end-of-run report says what was live.",
    ...describeNeighbours(neighbours).map((line) => `[contention]${line}`),
    ...pressure.map((reason) => `[contention]  - ${reason}`),
  ].join("\n");
}

function pressureReasons(start: HostSnapshot, end: HostSnapshot): string[] {
  const atStart = hostPressure(start.load, start.containers).reasons;
  const atEnd = hostPressure(end.load, end.containers).reasons;
  const seen = new Set([...atStart, ...atEnd]);
  const when = (reason: string): string => {
    if (atStart.includes(reason) && atEnd.includes(reason)) return "throughout";
    return atStart.includes(reason) ? "at start" : "at end";
  };
  return [...seen].map((reason) => `  - ${when(reason)}: ${reason}`);
}

export function renderContentionReport(report: ContentionReport): string {
  const { seat, start, end, failures } = report;
  const annotated = failures.filter((failure) => failure.signature !== undefined);
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
