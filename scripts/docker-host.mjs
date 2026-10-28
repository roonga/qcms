/**
 * Publishing binds on the Docker host, not inside the process that asked for it, so in
 * the dev container every started container is a sibling on the host's loopback and
 * `localhost` reaches nothing. The address that works there is the default-route
 * gateway, and only for a publish bound to all interfaces.
 *
 * `host.docker.internal` is deliberately not used: it accepts a TCP connection on
 * Docker Desktop and then times out on a real session, which is worse than a refusal.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const DOCKER_PUBLISH_HOST_ENV_VAR = "QCMS_DOCKER_PUBLISH_HOST";

/** Docker's marker file, present in every container it starts. */
export const DOCKER_ENV_MARKER = "/.dockerenv";

export function isInDockerContainer(marker = DOCKER_ENV_MARKER) {
  return existsSync(marker);
}

/** Linux's IPv4 routing table, the same one `ip route` formats. */
export const ROUTE_TABLE_PATH = "/proc/net/route";

/** Probed rather than resolved through `PATH` (`sonarjs/no-os-command-from-path`). */
const IP_BINARY_CANDIDATES = ["/usr/sbin/ip", "/sbin/ip", "/usr/bin/ip", "/bin/ip"];

/** The all-zero destination that marks the default route in `/proc/net/route`. */
const DEFAULT_ROUTE_DESTINATION = "00000000";

/**
 * The kernel writes the address in host byte order printed as big-endian hex, so the
 * low byte of the parsed number is the first octet. An all-zero gateway is an on-link
 * default route with no address to dial, and yields `undefined` rather than `0.0.0.0`.
 */
export function ipv4FromRouteField(field) {
  if (!/^[0-9A-Fa-f]{8}$/.test(field)) return undefined;
  const value = Number.parseInt(field, 16);
  if (value === 0) return undefined;
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
    .map(String)
    .join(".");
}

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

export function gatewayFromIpRoute(candidates = IP_BINARY_CANDIDATES) {
  for (const binary of candidates) {
    if (!existsSync(binary)) continue;
    const result = spawnSync(binary, ["route"], { encoding: "utf8" });
    const gateway = result.stdout?.match(/default via (\S+)/)?.[1];
    if (gateway !== undefined) return gateway;
  }
  return undefined;
}

export function defaultRouteGateway() {
  return gatewayFromRouteTable() ?? gatewayFromIpRoute();
}

export function publishedPortHost({
  override = process.env[DOCKER_PUBLISH_HOST_ENV_VAR],
  inContainer = existsSync(DOCKER_ENV_MARKER),
  gateway = defaultRouteGateway,
} = {}) {
  const explicit = (override ?? "").trim();
  if (explicit !== "") return explicit;
  if (!inContainer) return "localhost";
  return gateway() ?? "localhost";
}
