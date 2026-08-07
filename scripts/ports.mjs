/**
 * The QCMS port allocation, as code (issue #255).
 *
 * `docs/PORTS.md` is the authoritative document: the rule, the full table, the
 * reasoning per block, and the multi-seat design intent all live there. This module
 * is its executable half, and it is deliberately the ONLY place the arithmetic is
 * written down. Root scripts (`dev-stack.mjs`, behind `pnpm dev:portal` and
 * `pnpm dev:admin`, and `serve-artifacts.mjs`) import it
 * directly; the Playwright harness imports it through
 * `apps/portal/e2e/support/port-seat.ts`, which adds the occupancy checks.
 *
 * It is `.mjs` rather than `.ts` for exactly one reason: the repo's dev scripts are
 * plain ESM run by `node` with no build step, so a TypeScript module here would
 * force either a build or a second copy of the arithmetic, and a second copy is the
 * thing this file exists to prevent.
 *
 * ## The rule
 *
 * QCMS allocates two blocks, split by lifetime and audience, and that split is what
 * tells you where anything new belongs:
 *
 *   - **4-digit `7Sxx`** - stable, long-running, human-facing services. A person may
 *     open these in a browser. `7S00` portal, `7S10` API, `7S20` Postgres, `7S30`
 *     artifacts.
 *   - **5-digit `17Sxx`** - ephemeral test harness. Nothing outside the suite should
 *     ever point at these. `17S00` portal, `17S10` API, `17S30` OTLP receiver,
 *     `17S40` admin.
 *
 * `S` is the **seat**: one index, `QCMS_PORT_SEAT`, selecting both blocks together,
 * so a seat is a single number to reason about rather than two knobs to keep in
 * step. Seat 0 is the default and is exactly today's allocation (7000 / 7010 / 7020
 * / 7030), so an existing developer and CI notice nothing.
 *
 * ## Why 17xxx and not 7xxxx
 *
 * "Five digits, keep the 7" reads as `7xxxx`, which is above the maximum TCP port
 * (65535) and cannot bind at all. `17xxx` keeps the mnemonic and stays legal. It
 * also sits below the kernel's ephemeral range in every configuration seen so far,
 * which matters: a fixed listener inside `ip_local_port_range` occasionally loses a
 * race to a kernel-assigned socket, and that is the worst flake class there is.
 * `assertSeatPortsOutsideEphemeralRange` reads the live range rather than trusting
 * it, so a differently-tuned machine gets an error naming the cause.
 */

import { readFileSync, statSync } from "node:fs";

/** The one environment variable that selects a seat. */
export const PORT_SEAT_ENV_VAR = "QCMS_PORT_SEAT";

/** Seat 0: the default, and byte for byte today's allocation. */
export const DEFAULT_PORT_SEAT = 0;

/** Lowest selectable seat. */
export const MIN_PORT_SEAT = 0;

/**
 * Highest selectable seat, and a deliberate ceiling rather than an arbitrary one: a
 * single digit is what keeps `7Sxx` four digits and `17Sxx` five, and ten concurrent
 * dev stacks or browser suites already exceed what one workstation can run honestly.
 * See `docs/PORTS.md`.
 */
export const MAX_PORT_SEAT = 9;

/** First port of the stable, human-facing block. */
const STABLE_BLOCK_BASE = 7000;

/** First port of the ephemeral test-harness block. */
const HARNESS_BLOCK_BASE = 17000;

/** How far apart two seats' blocks sit, in both blocks. */
const SEAT_BLOCK_SIZE = 100;

/**
 * Stable, human-facing services and their offset inside a seat's `7Sxx` block.
 *
 * Postgres has a slot here and deliberately has none in the harness block: a harness
 * run boots a Testcontainers Postgres on a kernel-assigned port and never wants a
 * fixed one. Leaving `17S20` empty keeps the two blocks the same shape, so `17S{nn}`
 * maps onto `7S{nn}` without a second table.
 */
export const STABLE_SERVICES = {
  portal: 0,
  api: 10,
  postgres: 20,
  artifacts: 30,
  // The admin dev server. Allocated at offset 40 so the two blocks stay the same
  // shape (the harness admin is at `17S40`), rather than picked. Real since issue
  // #281: `pnpm dev:admin` listens on it and the dev container publishes seat 0's
  // 7040. See docs/PORTS.md.
  admin: 40,
};

/** Ephemeral test-harness services and their offset inside a seat's `17Sxx` block. */
export const HARNESS_SERVICES = {
  portal: 0,
  api: 10,
  otlp: 30,
  admin: 40,
};

/**
 * Read a seat number out of a raw environment value.
 *
 * Unset, or empty (which is how an unset shell variable often arrives), means
 * {@link DEFAULT_PORT_SEAT}. Anything else must be a single digit 0-9: a bad value
 * throws here rather than being coerced, because the failure it prevents is a run
 * that quietly binds a nonsense port or, worse, falls back to seat 0 and adopts
 * another seat's servers. That silent landing is the whole defect of issue #255, so
 * this is the one place it must not be repeated.
 *
 * @param {string | undefined} raw
 * @returns {number}
 */
export function resolvePortSeat(raw) {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_PORT_SEAT;
  if (!/^[0-9]$/.test(value)) {
    throw new Error(
      `${PORT_SEAT_ENV_VAR}="${raw ?? ""}" is not a valid port seat. ` +
        `It must be a single digit ${MIN_PORT_SEAT}-${MAX_PORT_SEAT} ` +
        `(seat S owns 7S00-7S99 and 17S00-17S99), or unset for the default seat ` +
        `${DEFAULT_PORT_SEAT}. See docs/PORTS.md.`,
    );
  }
  return Number(value);
}

/**
 * The seat this process runs in, resolved once from the ambient environment.
 *
 * @type {number}
 */
export const PORT_SEAT = resolvePortSeat(process.env[PORT_SEAT_ENV_VAR]);

/**
 * @param {number} seat
 * @returns {number} the seat, validated.
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
 * The port a stable, human-facing service listens on for `seat`.
 *
 * @param {keyof typeof STABLE_SERVICES} service
 * @param {number} [seat]
 * @returns {number}
 */
export function stablePort(service, seat = PORT_SEAT) {
  return STABLE_BLOCK_BASE + checkedSeat(seat) * SEAT_BLOCK_SIZE + STABLE_SERVICES[service];
}

/**
 * The port a test-harness service listens on for `seat`.
 *
 * @param {keyof typeof HARNESS_SERVICES} service
 * @param {number} [seat]
 * @returns {number}
 */
export function harnessPort(service, seat = PORT_SEAT) {
  return HARNESS_BLOCK_BASE + checkedSeat(seat) * SEAT_BLOCK_SIZE + HARNESS_SERVICES[service];
}

/**
 * Every harness port `seat` owns, in service order.
 *
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
 * The Compose project name for `seat`'s dev database.
 *
 * Two Compose stacks with the same project name ARE the same stack, and the failure is
 * worse than sharing. A second seat that moved only `QCMS_DB_PORT` would present
 * Compose with the same project and a changed port mapping, so `docker compose up -d`
 * RECREATES the running container on the new port against the same volume: seat 1 does
 * not quietly join seat 0's database, it takes it away mid-session. Seat 0's processes
 * keep dialling a port nothing serves any more. That is what makes the project name
 * necessary rather than tidy.
 * `COMPOSE_PROJECT_NAME` takes precedence over the `name:` in
 * `docker-compose.dev.yml`, and the named volume is namespaced by project, so a
 * distinct name gives a seat its own container AND its own data directory.
 *
 * Seat 0 returns the unchanged `qcms-dev`, so nothing about today's stack moves.
 *
 * @param {number} [seat]
 * @returns {string}
 */
export function composeProjectName(seat = PORT_SEAT) {
  return checkedSeat(seat) === DEFAULT_PORT_SEAT ? "qcms-dev" : `qcms-dev-s${String(seat)}`;
}

/** Where Linux publishes the kernel's ephemeral (auto-assigned) port window. */
export const EPHEMERAL_RANGE_PATH = "/proc/sys/net/ipv4/ip_local_port_range";

/**
 * The live ephemeral port range, or `undefined` where it cannot be read.
 *
 * Read rather than hard-coded on purpose: it is 32768-60999 on a stock Linux, but it
 * is tunable and CI runners differ, so one machine's measurement is not a fact about
 * the next one.
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
 * Fail loudly when a seat's harness ports fall inside the kernel's ephemeral range.
 *
 * A fixed listener in that window binds fine almost every time and then, rarely,
 * loses the port to a kernel-assigned socket that got there first: unreproducible,
 * and indistinguishable from a genuine startup failure. Asserting it at startup
 * turns it into one line naming the cause. The stable block is four digits and
 * cannot reach any plausible ephemeral range, so only the harness block is checked.
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
 * Drop trailing separators, so `/repo/` and `/repo` compare equal.
 *
 * A loop rather than a `/\/+$/` replace: that pattern is super-linear on a long run
 * of slashes and `sonarjs/super-linear-regex` rejects it, correctly.
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
 * Whether `repoRoot` is a **linked** git worktree.
 *
 * A linked worktree has a `.git` FILE (`gitdir: ...`) where a primary checkout has a
 * directory, which is a reliable, zero-cost tell. No `.git` at all (a tarball, a
 * container copy) is reported as not-a-worktree: there is nothing reliable to infer,
 * and inferring anyway would refuse runs that have done nothing wrong.
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
 * Refuse an unset seat when running from a linked git worktree.
 *
 * The reasoning is in `docs/PORTS.md` ("startup refusals", and "the residual risk"),
 * and it is worth restating why the refusal is scoped this way. Per-seat isolation
 * makes two *different* seats unable to meet. The remaining failure is not a port
 * collision, it is a **seat collision**: two runs that both fall back to seat 0.
 *
 * The default cannot simply be removed, because seat 0 must stay byte-identical for
 * an existing developer and for CI. But the population that collides is neither: it
 * is concurrent agent lanes, and by this repo's own rules every one of them runs in a
 * `git worktree`. So the primary checkout and CI keep the silent default, and a
 * worktree must say which seat it wants.
 *
 * This lives here rather than in one harness because there are now two callers with
 * the same exposure: the Playwright browser harness
 * (`apps/portal/e2e/support/port-seat.ts`) and the full-stack Compose harness
 * (`scripts/compose-e2e.mjs`, issue #296). The Compose one is the more dangerous of
 * the two: it derives a Compose PROJECT NAME from the seat, boots real containers
 * under it, and runs `docker compose down --volumes` on teardown, so a silent seat 0
 * does not merely read another lane's stack, it can delete it.
 *
 * @param {string} repoRoot the checkout this run belongs to.
 * @param {string} command how to spell the fix, e.g. `pnpm up:e2e`.
 * @param {string | undefined} [raw] the seat as given, normally from the environment.
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
