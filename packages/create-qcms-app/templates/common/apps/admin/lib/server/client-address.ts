/** Count trusted proxy hops from the right so client-supplied padding cannot choose a throttle bucket. Overstating hops can trust attacker input. Addresses are personal data: never log or render them. */

export const CLIENT_ADDRESS_HEADER = "x-qcms-client-address";

/** The inbound header the ingress writes. Read here, never forwarded onward. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

export const TRUSTED_PROXY_HOPS_VAR = "QCMS_ADMIN_TRUSTED_PROXY_HOPS";

const DEFAULT_TRUSTED_PROXY_HOPS = 1;

const MAX_TRUSTED_PROXY_HOPS = 8;

const MAX_ADDRESS_LENGTH = 64;

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const IPV4_WITH_PORT = /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

const IPV6_CHARS = /^[0-9a-f:.%]+$/;

/** Invalid trust configuration must throw rather than silently select another trust boundary; errors name the variable only. */
export function trustedProxyHops(): number {
  const raw = process.env.QCMS_ADMIN_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRUSTED_PROXY_HOPS;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TRUSTED_PROXY_HOPS) {
    throw new Error(
      `${TRUSTED_PROXY_HOPS_VAR} must be a whole number from 0 to ${String(MAX_TRUSTED_PROXY_HOPS)}`,
    );
  }
  return parsed;
}

/** Strip ports: per-connection ports would create a fresh throttle bucket per request. Invalid entries fall back to the shared bucket. */
function normalizeAddress(raw: string): string | undefined {
  let value = raw.toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return undefined;
    value = value.slice(1, end);
  } else if (IPV4_WITH_PORT.test(value)) {
    value = value.slice(0, value.lastIndexOf(":"));
  }
  if (value === "" || value.length > MAX_ADDRESS_LENGTH) return undefined;
  if (IPV4.test(value)) {
    return value.split(".").every((octet) => Number(octet) <= 255) ? value : undefined;
  }
  return value.includes(":") && IPV6_CHARS.test(value) ? value : undefined;
}

/** A short chain cannot prove which entry a trusted proxy wrote; return no assertion rather than trusting client padding. */
export function resolveClientAddress(
  forwardedFor: string | null | undefined,
  hops: number,
): string | undefined {
  if (hops < 1 || forwardedFor === null || forwardedFor === undefined) return undefined;
  const chain = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (chain.length < hops) return undefined;
  const entry = chain[chain.length - hops];
  return entry === undefined ? undefined : normalizeAddress(entry);
}

/** No address fallback: better-auth uses its shared bucket when this BFF cannot vouch for a client address. */
export function vouchedClientAddress(from: Headers): string | undefined {
  const hops = trustedProxyHops();
  if (hops < 1) return undefined;
  return resolveClientAddress(from.get(FORWARDED_FOR_HEADER), hops);
}
