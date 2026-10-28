/**
 * The environment a respondent request belongs to, and the address shape that carries it
 * (ADR-40, Q16, Q21, SEC-14).
 *
 * SEC-14 gives a non-prod environment two handles that fail independently: the hostname,
 * which a network-layer firewall and a DNS split can act on without reading HTTP, and
 * the `/<env>/` path prefix, which an ingress can act on and which makes a link legible
 * as non-production before it is clicked (Q16). This module owns both on the portal's
 * side; `proxy.ts` applies them to a request.
 *
 * Every address the portal emits has to carry the prefix, because the proxy's rewrite
 * makes the prefixed form work without making it the form anything produces.
 */

import { headers } from "next/headers";

export const PROD_ENVIRONMENT = "prod";

/**
 * The same spelling the API's admin group reads its switcher value from, so one header
 * name means "which environment is this request about" across the deployment.
 *
 * Set by the proxy and never trusted from outside: the proxy overwrites it on every
 * request, so a respondent cannot name an environment, and the portal's own `fetch` does
 * not forward it, because the API takes a respondent request's environment from the
 * group that served it (SEC-14).
 */
export const ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * Absent means none, which is the fail-closed direction: an unlisted environment's
 * addresses are a 404 rather than a surface nobody meant to expose.
 *
 * `prod` is filtered out rather than refused, since there is no `/prod/` address to serve
 * either way, and each name is checked against Q42's rule so a malformed entry cannot
 * become a path segment.
 */
export function nonProdEnvironments(): readonly string[] {
  const raw = process.env.QCMS_PORTAL_ENVIRONMENTS;
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "" && name !== PROD_ENVIRONMENT && /^[a-z][a-z0-9]*$/.test(name));
}

/**
 * SEC-14's first handle, as optional `<env>=<host>` pairs. What it buys is narrow: on a
 * host named here `/f/{slug}` is not served, so the public anonymous door does not exist
 * on the restricted hostname.
 *
 * It does not restrict the prefixed addresses to that host, because the two handles have
 * to fail independently (Q21): tying one to the other would make them one handle wearing
 * two names.
 */
export function environmentHosts(): ReadonlyMap<string, string> {
  const raw = process.env.QCMS_PORTAL_ENVIRONMENT_HOSTS;
  const hosts = new Map<string, string>();
  if (raw === undefined || raw.trim() === "") return hosts;
  for (const entry of raw.split(",")) {
    const [name, host] = entry.split("=").map((part) => part.trim().toLowerCase());
    if (name === undefined || host === undefined || name === "" || host === "") continue;
    if (name === PROD_ENVIRONMENT) continue;
    hosts.set(name, host);
  }
  return hosts;
}

export function environmentForHost(host: string | null): string | undefined {
  if (host === null) return undefined;
  // A `Host` header carries the port; a firewall rule and a DNS record do not.
  const bare = host.toLowerCase().split(":")[0] ?? "";
  for (const [name, reserved] of environmentHosts()) {
    if (reserved === bare) return name;
  }
  return undefined;
}

/**
 * Exported so the proxy, every emitted address and the tests share one derivation rather
 * than three spellings of a rule that could drift apart (Q21).
 */
export function environmentPrefix(environment: string): string {
  return environment === PROD_ENVIRONMENT ? "" : `/${environment}`;
}

export function environmentPath(environment: string, path: string): string {
  return `${environmentPrefix(environment)}${path}`;
}

/**
 * `prod` when nothing named one, which covers a request the proxy did not run in front
 * of, such as a build-time render. No validation here and none wanted: the proxy has
 * already resolved the name against the configured set and answered 404 for anything
 * else.
 *
 * `headers()` throws outside a request scope, and that is caught because a header which
 * cannot be resolved must not take the request with it.
 */
export async function currentEnvironment(): Promise<string> {
  try {
    const named = (await headers()).get(ENVIRONMENT_HEADER);
    return named === null || named === "" ? PROD_ENVIRONMENT : named;
  } catch {
    return PROD_ENVIRONMENT;
  }
}

/**
 * For a page to hand its client components as a prop rather than have them read it: a
 * client component cannot read a request header, and parsing `window.location` would
 * make every browser-side `fetch` depend on the address it happens to be on.
 */
export async function currentBasePath(): Promise<string> {
  return environmentPrefix(await currentEnvironment());
}
