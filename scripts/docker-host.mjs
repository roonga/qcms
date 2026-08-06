/**
 * Where a Docker-published port is reachable **from this process** (issue #316).
 *
 * `docs/PORTS.md` says which numbers we allocate. This module answers the other
 * half of the same question, the one that only has a single correct answer per
 * environment: which *host* those numbers are published on, as seen from here.
 *
 * ## Why this is not always `localhost`
 *
 * Publishing binds on the **Docker host**, never inside the process that asked for
 * it. In the canonical dev container (ADR-29) `docker compose` talks to the mounted
 * host socket (docker-outside-of-docker), so every container it starts is a SIBLING
 * of this one, published on the *host's* loopback. This container's own `127.0.0.1`
 * has nothing on it, and a run that dials `localhost` fails with `ECONNREFUSED`
 * while `docker compose ps` reports every service healthy - the exact shape of
 * issue #316, and the reason `pnpm up:e2e` was CI-only from the dev container.
 *
 * Where the port is published on **all** interfaces, the address that works is the
 * container's **default-route gateway**, which is the host. `scripts/dev-portal.mjs`
 * has reached the dev database that way since task 030, and that is what
 * `publishedPortHost` below answers.
 *
 * `host.docker.internal` is deliberately not used. It looks right and even accepts a
 * TCP connection on Docker Desktop, but a real Postgres session against it times
 * out - so a plain reachability probe is not sufficient evidence for this path, and
 * a wrong answer that times out is worse than one that is refused.
 *
 * ## The three environments, and why the fallback is `localhost`
 *
 * - **Dev container**: `/.dockerenv` exists, a default route exists, so the gateway
 *   is returned.
 * - **Plain host checkout**: no `/.dockerenv`, so `localhost` is returned before any
 *   routing table is consulted.
 * - **CI**: the GitHub-hosted runner is a plain host, so it takes the same
 *   `localhost` branch as a host checkout.
 *
 * The final fallback is `localhost` rather than a guess, for the same reason:
 * `localhost` is right in two of the three environments, and where it is wrong it
 * fails fast and legibly (connection refused) instead of hanging.
 *
 * ## What this does NOT solve, and why the full-stack harness needs more
 *
 * The gateway only reaches a publish that is bound to all interfaces, which is what
 * `docker-compose.dev.yml` does. The solo stack in `docker-compose.yml` deliberately
 * binds its publish to the host's **loopback** (a bare `PORT:3000` would put the
 * authoring admin on every network the host can reach), and no sibling container can
 * reach a host-loopback listener at any address. Widening that bind is not on the
 * table, and browsing the gateway would break `Secure` cookies anyway - so the
 * full-stack harness does not use `publishedPortHost` at all. It uses
 * `isInDockerContainer` to decide whether to join the Compose network and forward
 * this container's own loopback instead (`scripts/loopback-forward.mjs`, issue #316).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Escape hatch: an explicit answer always wins over any detection below. */
export const DOCKER_PUBLISH_HOST_ENV_VAR = "QCMS_DOCKER_PUBLISH_HOST";

/** Docker's marker file, present in every container it starts. */
export const DOCKER_ENV_MARKER = "/.dockerenv";

/**
 * Whether this process is inside a container, and therefore whether the Docker host
 * is a different machine from this one.
 *
 * The predicate the full-stack harness branches on: on a plain host checkout and on
 * a CI runner the answer is `false`, `localhost` already reaches a published port,
 * and none of the container-only machinery (network join, loopback forwarder) is
 * built at all.
 *
 * @param {string} [marker]
 * @returns {boolean}
 */
export function isInDockerContainer(marker = DOCKER_ENV_MARKER) {
  return existsSync(marker);
}

/** Linux's IPv4 routing table, the same one `ip route` formats. */
export const ROUTE_TABLE_PATH = "/proc/net/route";

/**
 * Where `ip` may live, as absolute paths.
 *
 * Probed rather than resolved through `PATH`: a subprocess launched by name is what
 * `sonarjs/no-os-command-from-path` exists to stop, and the rule is workspace-wide.
 * Order is by likelihood on Debian/Ubuntu, which is what the dev container is.
 */
const IP_BINARY_CANDIDATES = ["/usr/sbin/ip", "/sbin/ip", "/usr/bin/ip", "/bin/ip"];

/** The all-zero destination that marks the default route in `/proc/net/route`. */
const DEFAULT_ROUTE_DESTINATION = "00000000";

/**
 * Turn one `/proc/net/route` address field into dotted-quad IPv4.
 *
 * The kernel writes each address as the 32-bit value in **host** (little-endian)
 * byte order, printed big-endian as hex: `172.17.0.1` appears as `010011AC`. So the
 * low byte of the parsed number is the first octet.
 *
 * Returns `undefined` for the all-zero gateway, which is how an on-link default
 * route is spelled: there is no router address to dial, so the caller must fall
 * through rather than hand back `0.0.0.0`.
 *
 * @param {string} field
 * @returns {string | undefined}
 */
export function ipv4FromRouteField(field) {
  if (!/^[0-9A-Fa-f]{8}$/.test(field)) return undefined;
  const value = Number.parseInt(field, 16);
  if (value === 0) return undefined;
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
    .map(String)
    .join(".");
}

/**
 * The default-route gateway read straight out of the kernel's routing table.
 *
 * Preferred over shelling out because it needs no subprocess, no `PATH`, and no
 * binary that a slim image might not ship: it is the very table `ip route` reads.
 * Returns `undefined` where the table cannot be read or carries no usable default
 * route, so the caller can try the command form next.
 *
 * @param {string} [path]
 * @returns {string | undefined}
 */
export function gatewayFromRouteTable(path = ROUTE_TABLE_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    const destination = columns[1];
    const gateway = columns[2];
    if (destination !== DEFAULT_ROUTE_DESTINATION || gateway === undefined) continue;
    const address = ipv4FromRouteField(gateway);
    if (address !== undefined) return address;
  }
  return undefined;
}

/**
 * The default-route gateway as `ip route` reports it.
 *
 * Kept as a second opinion because it is the form that was actually proven against a
 * live database (`scripts/dev-portal.mjs`, task 030), and because it can still
 * answer on a system whose `/proc` this process cannot read. Each candidate is an
 * absolute path, never a bare command name.
 *
 * @param {readonly string[]} [candidates]
 * @returns {string | undefined}
 */
export function gatewayFromIpRoute(candidates = IP_BINARY_CANDIDATES) {
  for (const binary of candidates) {
    if (!existsSync(binary)) continue;
    const result = spawnSync(binary, ["route"], { encoding: "utf8" });
    const gateway = result.stdout?.match(/default via (\S+)/)?.[1];
    if (gateway !== undefined) return gateway;
  }
  return undefined;
}

/**
 * This container's default-route gateway, or `undefined` when there is none.
 *
 * @returns {string | undefined}
 */
export function defaultRouteGateway() {
  return gatewayFromRouteTable() ?? gatewayFromIpRoute();
}

/**
 * The host a Docker-published port is reachable on from here.
 *
 * @param {object} [options] injection points, so the three environments above are
 *   testable without being in them.
 * @param {string | undefined} [options.override] explicit answer, normally
 *   `QCMS_DOCKER_PUBLISH_HOST`.
 * @param {boolean} [options.inContainer] whether this process is in a container.
 * @param {() => string | undefined} [options.gateway] default-route resolution.
 * @returns {string}
 */
export function publishedPortHost({
  override = process.env[DOCKER_PUBLISH_HOST_ENV_VAR],
  inContainer = existsSync(DOCKER_ENV_MARKER),
  gateway = defaultRouteGateway,
} = {}) {
  const explicit = (override ?? "").trim();
  if (explicit !== "") return explicit;
  // A host checkout and a CI runner both land here, before anything is probed.
  if (!inContainer) return "localhost";
  return gateway() ?? "localhost";
}
