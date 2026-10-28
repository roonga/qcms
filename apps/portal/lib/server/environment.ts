import { headers } from "next/headers";

export const PROD_ENVIRONMENT = "prod";

export const ENVIRONMENT_HEADER = "x-qcms-environment";

/** Absent means none, which is the fail-closed direction: an unlisted environment's addresses are a 404 rather than a surface nobody meant to expose. */
export function nonProdEnvironments(): readonly string[] {
  const raw = process.env.QCMS_PORTAL_ENVIRONMENTS;
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "" && name !== PROD_ENVIRONMENT && /^[a-z][a-z0-9]*$/.test(name));
}

/** SEC-14's first handle, as optional `<env>=<host>` pairs. */
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
