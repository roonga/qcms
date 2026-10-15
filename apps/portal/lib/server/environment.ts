/**
 * The environment a respondent request belongs to, and the address shape that carries it
 * (ADR-40, Q16, Q21, SEC-14, task 066).
 *
 * # The two handles, and which one this module is
 *
 * SEC-14 gives a non-prod environment **two** handles, and they fail independently. The
 * **hostname** is primary, because a network-layer firewall and a DNS split can act on it
 * without reading HTTP at all. The **`/<env>/` path prefix** is the second, available to
 * an ingress or an L7 firewall as a rule of its own, and it is also what makes a link
 * legible as non-production to the person holding it before they click it (Q16).
 *
 * This module owns both on the portal's side: the prefix derivation every emitted address
 * goes through, and the host map an operator configures. `proxy.ts` is where they are
 * applied to a request.
 *
 * # Why the prefix is resolved once, in the proxy
 *
 * `proxy.ts` strips `/<env>` and rewrites to the unprefixed route, carrying the name on a
 * request header. So there is one route tree rather than one per environment, which is
 * what keeps a new respondent screen from being a file per environment - and the header
 * is read back here by {@link currentEnvironment} wherever a server component, a route
 * handler or a server action needs it.
 *
 * **Every address the portal emits must carry the prefix**, because the rewrite makes the
 * prefixed form work without making it the form anything produces. {@link environmentPath}
 * is that one derivation and {@link currentBasePath} is what a page hands its client
 * components so a browser-side `fetch` posts to its own environment.
 */

import { headers } from "next/headers";

/** The one environment with no prefix (Q21): prod is the unprefixed address shape. */
export const PROD_ENVIRONMENT = "prod";

/**
 * The request header `proxy.ts` carries a resolved environment name on.
 *
 * The same spelling the API's admin group reads its switcher value from, deliberately:
 * one header name for "which environment is this request about" across the deployment,
 * even though the two surfaces set it from different places (Q2's two sources).
 *
 * It is **set by the proxy and never trusted from outside**: the proxy overwrites it on
 * every request from the path it resolved, so a respondent who sends one of their own
 * cannot name an environment. The portal's own `fetch` to the API does not forward it
 * either - the API takes a respondent request's environment from the group that served
 * it, which is the half SEC-14 rests on.
 */
export const ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * The non-prod environments this deployment serves, in the order it names them.
 *
 * `QCMS_PORTAL_ENVIRONMENTS`, a comma-separated list, and **absent means none**: a
 * deployment that says nothing serves `prod` only, which is both the single-environment
 * shape and the fail-closed direction - an unlisted environment's addresses are a 404
 * rather than a surface nobody meant to expose.
 *
 * `prod` is filtered out rather than refused, because an operator listing the whole set
 * is making an understandable mistake and the answer is the same either way: prod is the
 * unprefixed shape, so there is no `/prod/` address to serve. The names are checked
 * against Q42's rule, so a malformed entry cannot become a path segment.
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
 * The hostname each non-prod environment's traffic arrives on, when an operator has
 * configured one (SEC-14's first handle).
 *
 * `QCMS_PORTAL_ENVIRONMENT_HOSTS`, as `<env>=<host>` pairs: `test=test-forms.example.com`.
 * Optional, and what it buys is narrow and precise: on a host named here, **`/f/{slug}`
 * is not served**, so the public anonymous door does not exist on the restricted
 * hostname even in the shape where an ingress forwards everything to one portal.
 *
 * It deliberately does **not** restrict the prefixed addresses to that host. The two
 * handles fail independently (Q21): a path rule has to keep working on a shared hostname
 * somebody consolidated onto, and a host rule has to keep working through a proxy that
 * rewrites paths. Tying one to the other would make them one handle wearing two names.
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

/** Whether `host` is a hostname an operator has reserved for a non-prod environment. */
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
 * One environment's address prefix: `""` for `prod` and `/<env>` for every other (Q21).
 *
 * Exported so the one derivation is shared by the proxy, every emitted address and the
 * tests, rather than being three spellings of one rule that could drift apart.
 */
export function environmentPrefix(environment: string): string {
  return environment === PROD_ENVIRONMENT ? "" : `/${environment}`;
}

/** An absolute portal path under one environment: `environmentPath("test", "/done")`. */
export function environmentPath(environment: string, path: string): string {
  return `${environmentPrefix(environment)}${path}`;
}

/**
 * The environment this request belongs to, from the header `proxy.ts` resolved.
 *
 * `prod` when nothing named one, which is both the unprefixed address shape and the
 * answer for a request the proxy did not run in front of - a build-time render, say.
 * There is no validation here and none is wanted: the proxy has already resolved the
 * name against the configured set and answered `404` for anything else, so a name that
 * reaches this reader is one this deployment serves.
 *
 * `headers()` throws outside a request scope, which is a programming error rather than a
 * runtime condition for every caller here; it is caught for the reason
 * `currentRequestId` catches, which is that a header that cannot be resolved must not
 * take the request with it.
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
 * The address prefix of the environment serving this request, for a page to hand its
 * client components.
 *
 * A **prop rather than a second read in the browser**: a client component cannot read a
 * request header, and deriving the prefix from `window.location` would make every
 * browser-side `fetch` depend on parsing the address it happens to be on. One value,
 * passed down from the page that already knows it, is what keeps a `fetch` to
 * `/s/{id}/answers` from reaching `prod`'s route from a `test` session's page.
 */
export async function currentBasePath(): Promise<string> {
  return environmentPrefix(await currentEnvironment());
}
