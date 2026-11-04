/** Server configuration must never enter client bundles. Errors name variables and reasons only, never secret values. */

import { DEFAULT_LOCALE } from "../i18n/format.ts";
import { DEFAULT_PREVIEW_THEME, parsePreviewTheme, type PreviewTheme } from "../preview-theme.ts";

export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

/** Keep this private wire header in step with the API admin-auth middleware; it travels inside the token-gated internal channel. */
export const ADMIN_SESSION_HEADER = "x-qcms-admin-session";

/** Mirror the API password floor only as a client hint. Breach-corpus checks stay inside the API process; the API enforces both rules. */
export const MIN_PASSWORD_LENGTH = 12;

const DEFAULT_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required server env var ${name}`);
  }
  return value;
}

/** Boolean spellings must match the API parser or session and enrollment cookies can receive incompatible security attributes. */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean (true/false)`);
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer (ms)`);
  }
  return parsed;
}

export function apiBaseUrl(): string {
  let base = required("QCMS_API_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

export function internalToken(): string {
  return required("QCMS_INTERNAL_TOKEN");
}

/** Mirror the API placeholder vocabulary; check-bff-config-guards tests cross-app agreement. Normalise separators and match prefixes so example wording cannot bypass refusal. */
export const PLACEHOLDER_PREFIXES: readonly string[] = [
  "replace-",
  "change-me",
  "changeme",
  "your-",
  "example-",
  "placeholder",
  "<",
];

export function looksLikePlaceholder(raw: string): boolean {
  const value = raw.trim().toLowerCase().replaceAll("_", "-");
  return PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Only credential material belongs in this boot check; origins are configuration checked elsewhere. */
const SECRET_VARS: readonly string[] = ["QCMS_INTERNAL_TOKEN"];

/** Check every entry in the token rotation list and report only variable names. Missing values are tolerated during build workers; request-time readers reject them. */
export function assertNoPlaceholderSecrets(): void {
  const offenders = SECRET_VARS.filter((name) => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return false;
    return raw
      .split(/[\s,]+/)
      .filter((entry) => entry !== "")
      .some((entry) => looksLikePlaceholder(entry));
  });
  if (offenders.length === 0) return;

  throw new Error(
    [
      "Refusing to start: a required secret still holds a placeholder value from an example file.",
      `  observed: ${offenders.join(", ")} matches one of the shipped placeholder shapes (the value is not printed, SEC-8).`,
      "  effect: this deployment would authenticate its calls to the API with a value published in a public repository, so anyone could open the SEC-4 internal channel that carries the authoring surface.",
      "  remedy: generate real secrets (`openssl rand -base64 32`) and set the same value here and on the api service. See docs/operations.md.",
    ].join("\n"),
  );
}

/** Session, enrollment, recovery and appearance cookies must use the same security policy or browsers can drop one family and lock out enrollment. The boot guard rejects downgrades off loopback. */
export function secureCookies(): boolean {
  return boolEnv("QCMS_ADMIN_SECURE_COOKIES", process.env.NODE_ENV === "production");
}

/** Use the Secure Contexts loopback set: browsers treat these HTTP hosts as potentially trustworthy. URL hostnames include brackets around IPv6 literals. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace("[", "").replace("]", "");
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;
  const octets = bare.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/** Reject off-loopback cookie downgrades using the declared browser-facing base URL, not the container connection. Missing or invalid URLs are tolerated in build workers and rejected by request-time readers. */
/** Optional here: an absent portal origin hides the published-address block without breaking authoring. It is distinct from the admin origin used for CSRF. */
export function portalBaseUrl(): string | undefined {
  const raw = process.env.QCMS_PORTAL_BASE_URL?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

export function assertSecureCookiesConfigured(): void {
  if (secureCookies()) return;

  const configuredBase = process.env.QCMS_ADMIN_BASE_URL?.trim();
  if (configuredBase === undefined || configuredBase === "") return;

  let host: string;
  try {
    host = new URL(configuredBase).hostname;
  } catch {
    return;
  }
  if (isLoopbackHost(host)) return;

  const raw = process.env.QCMS_ADMIN_SECURE_COOKIES?.trim();
  const observed =
    raw === undefined || raw === ""
      ? 'QCMS_ADMIN_SECURE_COOKIES is unset and NODE_ENV is not "production"'
      : `QCMS_ADMIN_SECURE_COOKIES is set to "${raw}"`;

  throw new Error(
    [
      "Refusing to start: admin cookie security is downgraded for a non-loopback origin.",
      `  observed: ${observed}, while QCMS_ADMIN_BASE_URL is "${configuredBase}" (host "${host}" is not loopback).`,
      "  effect: the admin session, enrollment and recovery-view cookies would be set without `Secure`, so a browser would send an authoring credential over plain HTTP and any hop between the browser and this deployment could read it.",
      "  remedy: serve this origin over HTTPS and set QCMS_ADMIN_SECURE_COOKIES=true in BOTH the admin and api services (or remove it from both, so the images' NODE_ENV=production decides). To evaluate over plain HTTP, reach the admin at a loopback origin such as http://localhost:7040 and set QCMS_ADMIN_BASE_URL to match.",
    ].join("\n"),
  );
}

/** Share this browser-facing origin with better-auth baseURL and trustedOrigins so both hops enforce the same CSRF boundary. */
export function adminBaseUrl(): string {
  let base = required("QCMS_ADMIN_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/** Read the portal theme server-side and pass it to preview islands for the correct first paint. Unknown themes degrade to the base theme; admin chrome remains fixed. */
export function previewPortalTheme(): PreviewTheme {
  return parsePreviewTheme(process.env.QCMS_PORTAL_THEME) ?? DEFAULT_PREVIEW_THEME;
}

/** Optional 2FA is a development escape hatch. The API reads the same policy; the stricter side wins when deployments disagree. */
export function twoFactorPolicy(): "required" | "optional" {
  const raw = process.env.QCMS_ADMIN_2FA?.trim();
  if (raw === undefined || raw === "") return "required";
  if (raw === "required" || raw === "optional") return raw;
  throw new Error("QCMS_ADMIN_2FA must be `required` or `optional`");
}

export function twoFactorOptional(): boolean {
  return twoFactorPolicy() === "optional";
}

/** The API owns idle expiry; this BFF also enforces the absolute cap for its expired redirect. Keep both caps aligned: neither side may extend the other. */
export function sessionMaxAgeMs(): number {
  return positiveIntEnv("QCMS_ADMIN_SESSION_MAX_AGE_MS", DEFAULT_SESSION_MAX_AGE_MS);
}

/** This selects formatting, not catalog language. Reject unsupported tags instead of allowing silent Intl fallback; never echo the supplied value. */
export function parseLocale(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return DEFAULT_LOCALE;
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(trimmed)[0];
  } catch {
    canonical = undefined;
  }
  if (canonical === undefined || Intl.DateTimeFormat.supportedLocalesOf([canonical]).length === 0) {
    throw new Error(
      "QCMS_LOCALE must be a BCP 47 language tag this runtime supports, such as en-GB",
    );
  }
  return canonical;
}

/** Pass the server locale through providers so SSR and hydration format with the same tag. */
export function appLocale(): string {
  return parseLocale(process.env.QCMS_LOCALE);
}

/** Keep locale boot refusal aligned with the portal: both read the same variable. */
export function assertLocaleConfigured(): void {
  try {
    appLocale();
  } catch {
    throw new Error(
      [
        "Refusing to start: QCMS_LOCALE is not a usable locale.",
        "  observed: QCMS_LOCALE is set, but not to a BCP 47 language tag this runtime's Intl supports (the value is not printed).",
        "  effect: dates, numbers and date-field order would silently fall back to a convention nobody chose.",
        "  remedy: set a tag such as en-GB, en-US or de-DE, or remove the variable to use the en-GB default. See docs/operations.md.",
      ].join("\n"),
    );
  }
}
