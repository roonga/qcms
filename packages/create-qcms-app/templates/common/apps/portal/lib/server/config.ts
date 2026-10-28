/**
 * Server-only BFF configuration. None of it may reach the client bundle: the internal
 * API base URL and the SEC-4 internal service token are server secrets, and the R2
 * import-surface test enforces that no client component imports this.
 */

import { DEFAULT_LOCALE } from "../i18n/format";

export const SESSION_COOKIE = "qcms_session";

/** The SEC-4 internal-token header the API requires on every call. */
export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required server env var ${name}`);
  }
  return value;
}

/**
 * The same spellings the API's `parseBool` and the admin's `boolEnv` accept, which is
 * load-bearing: a knob one app recognises and another ignores looks set and is not.
 * Anything else is refused by name, because for a security flag a loud boot refusal is
 * the fail-closed posture.
 */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean (true/false)`);
}

/** No trailing slash. */
export function apiBaseUrl(): string {
  let base = required("QCMS_API_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

export function internalToken(): string {
  return required("QCMS_INTERNAL_TOKEN");
}

/**
 * Prefixes that mark a secret as one of the shipped examples rather than real material
 * (SEC-8: a deployment with placeholder secrets must refuse to boot).
 *
 * A deliberate copy of the API's list, since there is no shared package for a Next BFF's
 * server code. `scripts/check-bff-config-guards.test.ts` runs the API's list, this one
 * and the admin's against one corpus, so a spelling added on one side only is a red
 * rather than a silence.
 *
 * Separators are normalised before matching, and matching on the prefix rather than the
 * exact shipped strings keeps the guard working when the example wording changes.
 */
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

/**
 * One, today: the portal reads no signing key and no database credential, and its base
 * URLs are settings rather than secrets.
 */
const SECRET_VARS: readonly string[] = ["QCMS_INTERNAL_TOKEN"];

/**
 * Refuse to boot when a secret still holds an example-file placeholder.
 *
 * The API refuses too, so a composed deployment never comes up, but a BFF started on its
 * own would present a published token and discover it as a 401 at the first request
 * rather than as a refusal at boot. A boot refusal names the variable; a 401 does not.
 *
 * It reports the variable name and nothing else: SEC-8 forbids echoing the value even
 * when it is known to be worthless, because the same path would handle a real one.
 *
 * The value is split on commas and whitespace before matching, because the API accepts
 * `QCMS_INTERNAL_TOKEN` as a rotation list (first signs, all verify). A placeholder hiding
 * among real entries is refused the same as a lone one.
 *
 * ## Where it runs
 *
 * `instrumentation.ts`, beside {@link assertSecureCookiesConfigured}, for the same reason:
 * Next calls `register()` once per server process before anything serves, so the failure is
 * a boot failure rather than a 500 on the first request.
 *
 * An **unset** or empty value is passed rather than refused. That is a different defect,
 * `internalToken()` already fails loudly on it, and `register()` also runs in build-time
 * server workers where the variable is legitimately absent - the same reason the cookie
 * guard tolerates a missing base URL.
 *
 * ## Twin
 *
 * `apps/admin/lib/server/config.ts` carries this guard over the same variable. **Change
 * one, change the other** - and unlike the cookie guard's twin note, that reminder is
 * backed by a check: `scripts/check-bff-config-guards.test.ts` asserts both apps carry the
 * guard, that both call it at boot, and that all three placeholder vocabularies agree.
 */
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
      "  effect: this deployment would authenticate its calls to the API with a value published in a public repository, so anyone could open the SEC-4 internal channel.",
      "  remedy: generate real secrets (`openssl rand -base64 32`) and set the same value here and on the api service. See docs/operations.md.",
    ].join("\n"),
  );
}

/** The browser-facing origin, used for redirects produced inside the container. */
export function portalBaseUrl(): string {
  let base = required("QCMS_PORTAL_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/**
 * Whether the cookies this app sets carry `Secure`. Production is the safe default, and
 * Compose's documented localhost profile is the deliberate exception: a plain-HTTP stack
 * would create a session and then fail to resume it, the cookie being dropped.
 *
 * Named for what it decides rather than the environment it guesses from, so the next
 * caller wanting a production check for an unrelated reason does not get a cookie policy
 * instead. The downgrade is guarded by {@link assertSecureCookiesConfigured}.
 */
export function secureCookies(): boolean {
  return boolEnv("QCMS_SECURE_COOKIES", process.env.NODE_ENV === "production");
}

/**
 * Whether a browser treats `host` as potentially trustworthy even over plain HTTP, and
 * therefore one where dropping `Secure` costs nothing. The set is the Secure Contexts
 * one, because that specification is what decides whether the browser on the other side
 * keeps the cookie at all.
 *
 * @param host a URL hostname, so IPv6 literals arrive bracketed.
 */
export function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace("[", "").replace("]", "");
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;
  const octets = bare.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/**
 * Refuse to boot when cookie security is downgraded at an origin that is not loopback.
 *
 * A refusal rather than a warning: the example env file ships the downgrade, so an
 * operator who then puts the stack behind a TLS ingress carries it forward and nothing
 * complains while the deployment serves HTTPS and hands out a readable session cookie.
 *
 * Off-loopback is read from `QCMS_PORTAL_BASE_URL`, because the browser-facing scheme is
 * not something this process can observe: it sees a container port, not the ingress. It
 * therefore misses a deployment whose base URL is itself wrong, which is already broken
 * visibly, and it permits `https://localhost` with the downgrade on, which is pointless
 * rather than dangerous.
 *
 * It runs from `instrumentation.ts`, so the failure is a boot failure rather than a 500
 * on the first request, and deliberately not inside {@link secureCookies}, which unit
 * fixtures call with no base URL at all. A missing base URL passes: that is a different
 * defect, and `register()` also runs in build-time workers where it is legitimately
 * absent.
 *
 * `apps/admin/lib/server/config.ts` carries the same guard over its own two variables.
 * The variables stay separate on purpose, but the rule must not drift, and nothing
 * computes that the two suites assert the same cases (issue #412). Change one, change
 * the other.
 */
export function assertSecureCookiesConfigured(): void {
  if (secureCookies()) return;

  const configuredBase = process.env.QCMS_PORTAL_BASE_URL?.trim();
  if (configuredBase === undefined || configuredBase === "") return;

  let host: string;
  try {
    host = new URL(configuredBase).hostname;
  } catch {
    return;
  }
  if (isLoopbackHost(host)) return;

  // Report the value {@link secureCookies} actually compared, not only the one
  // spelling it recognises as false (issue #409). Branching on `raw === "false"`
  // alone told an operator who had written `QCMS_SECURE_COOKIES=off` that the
  // variable was "unset" - while they were looking at the line that sets it - and the
  // whole job of this line is to say which variable to check.
  //
  // Trimmed, because {@link boolEnv} trims: since issue #401 this reader accepts the
  // shared vocabulary and refuses anything else at the reader, so an unparseable value
  // throws before it can reach this line and the only cases left here are a genuine
  // false spelling or a genuinely unset variable. The message quotes what was compared,
  // which is now the trimmed value. Identical to the admin twin, deliberately.
  const raw = process.env.QCMS_SECURE_COOKIES?.trim();
  const observed =
    raw === undefined || raw === ""
      ? 'QCMS_SECURE_COOKIES is unset and NODE_ENV is not "production"'
      : `QCMS_SECURE_COOKIES is set to "${raw}"`;

  throw new Error(
    [
      "Refusing to start: respondent cookie security is downgraded for a non-loopback origin.",
      `  observed: ${observed}, while QCMS_PORTAL_BASE_URL is "${configuredBase}" (host "${host}" is not loopback).`,
      "  effect: the respondent session cookie would be set without `Secure`, so a browser would send it over plain HTTP and any hop between the browser and this deployment could read it.",
      "  remedy: serve this origin over HTTPS and set QCMS_SECURE_COOKIES=true (or remove it, so the image's NODE_ENV=production decides). The downgrade is supported only when QCMS_PORTAL_BASE_URL is a loopback origin such as http://localhost:7000.",
    ].join("\n"),
  );
}

/**
 * Read a `QCMS_LOCALE` value: a BCP 47 tag this runtime's `Intl` supports, returned in
 * canonical form, or {@link DEFAULT_LOCALE} when unset or blank (Code Owner ruling
 * 2026-10-19, ADR-27 amendment).
 *
 * It decides how dates, numbers and lists are FORMATTED and the order a date field
 * draws its day, month and year in. It does not choose a catalog: the portal's copy
 * stays English whatever this says (R7 defers a second catalog).
 *
 * An unparseable tag throws, and so does a well-formed one the runtime has no data for,
 * because `Intl` would otherwise fall back to some other locale silently and the
 * deployment would format in a convention nobody chose. The message never carries the
 * value (SEC-8's rule, applied to every refusal for consistency).
 */
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

/**
 * The deployment's formatting locale (`QCMS_LOCALE`). The root layout reads it once
 * per render and hands it to the client through `LocaleProvider`, so the server render
 * and the hydrated render format against the same tag rather than the host's or the
 * browser's.
 */
export function appLocale(): string {
  return parseLocale(process.env.QCMS_LOCALE);
}

/**
 * Refuse to boot on an unusable `QCMS_LOCALE`, from `instrumentation.ts`, so a typo is a
 * boot failure naming the variable rather than a 500 on the first page.
 *
 * **Twin:** `apps/admin/lib/server/config.ts`. Both apps read the one variable.
 */
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
