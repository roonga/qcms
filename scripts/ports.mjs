/**
 * The only place the port arithmetic is written down (`docs/PORTS.md`, ADR-37). The harness block is
 * `17Sxx` because `7Sxxx` exceeds 65535, and it sits below `ip_local_port_range`.
 */

import { readFileSync, statSync } from "node:fs";

export const PORT_SEAT_ENV_VAR = "QCMS_PORT_SEAT";

export const DEFAULT_PORT_SEAT = 0;

export const MIN_PORT_SEAT = 0;

/** A single digit is what keeps `7Sxx` four digits and `17Sxx` five. */
export const MAX_PORT_SEAT = 9;

const STABLE_BLOCK_BASE = 7000;

const HARNESS_BLOCK_BASE = 17000;

const SEAT_BLOCK_SIZE = 100;

/**
 * Offsets inside a seat's `7Sxx` block. Postgres has no harness counterpart, and
 * `17S20` is left empty so `17S{nn}` maps onto `7S{nn}` without a second table.
 */
export const STABLE_SERVICES = {
  portal: 0,
  api: 10,
  postgres: 20,
  artifacts: 30,
  admin: 40,
  // Toolbox slots are stable rather than harness because the test is lifetime and
  // audience: a dashboard a person opens and leaves running is human-facing.
  observability: 50,
  dbViewer: 60,
};

export const HARNESS_SERVICES = {
  portal: 0,
  api: 10,
  otlp: 30,
  admin: 40,
};

/**
 * A bad value throws rather than being coerced: coercion would land the run on seat 0
 * and adopt another seat's servers.
 *
 * @param {string | undefined} raw
 * @returns {number}
 */
export function resolvePortSeat(raw) {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_PORT_SEAT;
  if (!/^\d$/.test(value)) {
    throw new Error(
      `${PORT_SEAT_ENV_VAR}="${raw ?? ""}" is not a valid port seat. ` +
        `It must be a single digit ${MIN_PORT_SEAT}-${MAX_PORT_SEAT} ` +
        `(seat S owns 7S00-7S99 and 17S00-17S99), or unset for the default seat ` +
        `${DEFAULT_PORT_SEAT}. See docs/PORTS.md.`,
    );
  }
  return Number(value);
}

/** @type {number} */
export const PORT_SEAT = resolvePortSeat(process.env[PORT_SEAT_ENV_VAR]);

/**
 * @param {number} seat
 * @returns {number}
 */
function checkedSeat(seat) {
  if (!Number.isInteger(seat) || seat < MIN_PORT_SEAT || seat > MAX_PORT_SEAT) {
    throw new Error(
      `port seat ${String(seat)} is out of range (${MIN_PORT_SEAT}-${MAX_PORT_SEAT}). ` +
        `See docs/PORTS.md.`,
    );
  }
  return seat;
}

/**
 * @param {keyof typeof STABLE_SERVICES} service
 * @param {number} [seat]
 * @returns {number}
 */
export function stablePort(service, seat = PORT_SEAT) {
  return STABLE_BLOCK_BASE + checkedSeat(seat) * SEAT_BLOCK_SIZE + STABLE_SERVICES[service];
}

/**
 * @param {keyof typeof HARNESS_SERVICES} service
 * @param {number} [seat]
 * @returns {number}
 */
export function harnessPort(service, seat = PORT_SEAT) {
  return HARNESS_BLOCK_BASE + checkedSeat(seat) * SEAT_BLOCK_SIZE + HARNESS_SERVICES[service];
}

/**
 * @param {number} [seat]
 * @returns {{ service: keyof typeof HARNESS_SERVICES; port: number }[]}
 */
export function harnessPorts(seat = PORT_SEAT) {
  return Object.keys(HARNESS_SERVICES).map((service) => ({
    service: /** @type {keyof typeof HARNESS_SERVICES} */ (service),
    port: harnessPort(/** @type {keyof typeof HARNESS_SERVICES} */ (service), seat),
  }));
}

/**
 * A per-seat project name is required, not tidiness: two stacks sharing one project
 * name are one stack, and `up -d` with a changed port mapping recreates the running
 * container against the same volume, taking the other seat's database away.
 *
 * @param {number} [seat]
 * @returns {string}
 */
export function composeProjectName(seat = PORT_SEAT) {
  return checkedSeat(seat) === DEFAULT_PORT_SEAT ? "qcms-dev" : `qcms-dev-s${String(seat)}`;
}

/**
 * @param {number} [seat]
 * @returns {string}
 */
export function localStackProjectName(seat = PORT_SEAT) {
  return checkedSeat(seat) === DEFAULT_PORT_SEAT
    ? "qcms-local-stack"
    : `qcms-local-stack-s${String(seat)}`;
}

export const EPHEMERAL_RANGE_PATH = "/proc/sys/net/ipv4/ip_local_port_range";

/**
 * Read rather than hard-coded: the range is tunable and CI runners differ.
 *
 * @param {string} [path]
 * @returns {{ low: number; high: number } | undefined}
 */
export function ephemeralPortRange(path = EPHEMERAL_RANGE_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const [low, high] = text.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(low) || !Number.isInteger(high)) return undefined;
  return { low: /** @type {number} */ (low), high: /** @type {number} */ (high) };
}

/**
 * A fixed listener inside the ephemeral window rarely loses its port to a
 * kernel-assigned socket, which is unreproducible, so it is refused at startup.
 *
 * @param {number} [seat]
 * @param {{ low: number; high: number } | undefined} [range]
 * @returns {void}
 */
export function assertSeatPortsOutsideEphemeralRange(
  seat = PORT_SEAT,
  range = ephemeralPortRange(),
) {
  if (range === undefined) return;
  const inside = harnessPorts(seat).filter(
    (entry) => entry.port >= range.low && entry.port <= range.high,
  );
  if (inside.length === 0) return;
  throw new Error(
    [
      `Port seat ${String(seat)} overlaps this machine's ephemeral port range ` +
        `(${String(range.low)}-${String(range.high)}, from ${EPHEMERAL_RANGE_PATH}):`,
      ...inside.map((entry) => `  - ${entry.service} on ${String(entry.port)}`),
      "",
      "A fixed listener inside that window loses races against kernel-assigned",
      "sockets, which shows up as a rare unreproducible bind failure. Move the range",
      "(sysctl net.ipv4.ip_local_port_range) or the block. See docs/PORTS.md.",
    ].join("\n"),
  );
}

/**
 * A loop rather than a `/\/+$/` replace, which `sonarjs/super-linear-regex` rejects.
 *
 * @param {string} path
 * @returns {string}
 */
export function withoutTrailingSlash(path) {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

/**
 * A linked worktree has a `.git` file where a primary checkout has a directory. No
 * `.git` at all reports false, because there is nothing reliable to infer.
 *
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function isLinkedWorktree(repoRoot) {
  let gitEntry;
  try {
    gitEntry = statSync(`${withoutTrailingSlash(repoRoot)}/.git`);
  } catch {
    return false;
  }
  return gitEntry.isFile();
}

/**
 * Scoped to linked worktrees because the residual risk is a seat collision, not a
 * port collision: two runs both defaulting to seat 0 share one Compose project, and
 * teardown there runs `down --volumes` on the other lane's stack (`docs/PORTS.md`).
 *
 * @param {string} repoRoot
 * @param {string} command
 * @param {string | undefined} [raw]
 * @returns {void}
 */
export function assertPortSeatChosen(repoRoot, command, raw = process.env[PORT_SEAT_ENV_VAR]) {
  if ((raw ?? "").trim() !== "") return;
  if (!isLinkedWorktree(repoRoot)) return;
  throw new Error(
    [
      `${PORT_SEAT_ENV_VAR} is not set, and this is a linked git worktree:`,
      `  ${repoRoot}`,
      "",
      "Concurrent lanes run in worktrees, and two lanes that both fall back to the",
      "default seat collide on every harness port. Say which seat this run owns:",
      "",
      `  ${PORT_SEAT_ENV_VAR}=<${String(MIN_PORT_SEAT)}-${String(MAX_PORT_SEAT)}> ${command}`,
      "",
      `${PORT_SEAT_ENV_VAR}=0 is a valid answer when nothing else is running. See docs/PORTS.md.`,
    ].join("\n"),
  );
}
