/**
 * Server-only BFF configuration (task 029). These values are read from the
 * environment at request time and MUST never reach the client bundle: the
 * internal API base URL and the SEC-4 internal service token are server secrets.
 * Nothing here is imported by a client component (enforced by the R2
 * import-surface test).
 */

/** The name of the httpOnly cookie that holds the respondent's session bearer token. */
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
 * A boolean env knob, accepting the **same spellings** as the API's `parseBool`
 * (`apps/api/src/config.ts`) and the admin's `boolEnv`
 * (`apps/admin/lib/server/config.ts`): `true/1/yes/on` and `false/0/no/off`,
 * case-insensitive and trimmed, with anything else refused by name.
 *
 * That symmetry is the point rather than a nicety (issue #401). The portal used to
 * recognise only the literal `"true"` and `"false"` and silently fall back to
 * `NODE_ENV` for everything else, so an operator who wrote `QCMS_SECURE_COOKIES=off`
 * got a configuration that looked set and was not - the same failure shape issue #292
 * exists to eliminate, one layer down, and one that also slipped past the off-loopback
 * refusal because the refusal fires on the effective value.
 *
 * The thrown refusal is deliberate and is a boot-behaviour change: a deployment
 * currently passing a malformed value boots today, ignoring it, and refuses to boot
 * after. For a security flag a loud boot refusal is the correct fail-closed posture,
 * and such a deployment is already not getting the setting it asked for.
 */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean (true/false)`);
}

/** The internal API base URL (server-only). No trailing slash. */
export function apiBaseUrl(): string {
  let base = required("QCMS_API_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/** The SEC-4 internal service token presented to the API (server-only). */
export function internalToken(): string {
  return required("QCMS_INTERNAL_TOKEN");
}

/**
 * Value prefixes that mark a secret as one of the shipped examples rather than real
 * material (SEC-8: "a deployment with placeholder secrets must refuse to boot").
 *
 * **A deliberate copy of `PLACEHOLDER_PREFIXES` in `apps/api/src/config.ts`**, which is
 * where this control was built by task 040 and which remains the definition of record.
 * There is no shared package for a Next BFF's server code, the same call
 * `isLoopbackHost` below and the admin's `MIN_PASSWORD_LENGTH` make, so the vocabulary
 * is duplicated - and duplicated vocabularies drift, which is the whole of issues #401
 * and #402. It is therefore not left to a comment: `scripts/check-bff-config-guards.test.ts`
 * runs the API's list, this one and the admin's against one corpus from the repo root
 * and fails on any disagreement, so a spelling added on one side and not the others is
 * a red rather than a silence.
 *
 * Separators are normalised before matching, so `replace_with_...` is refused exactly as
 * `replace-with-...` is; matching on the prefix rather than on the exact shipped strings
 * keeps the guard working when the example wording changes.
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

/** True when `raw` is one of the shipped placeholders rather than real material. */
export function looksLikePlaceholder(raw: string): boolean {
  const value = raw.trim().toLowerCase().replaceAll("_", "-");
  return PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * The variables this app holds that are secret material. One, today: the portal reads no
 * signing key and no database credential, and its base URLs are settings rather than
 * secrets (a placeholder there is caught by the cookie guard below or by a visibly broken
 * redirect, not by this).
 */
const SECRET_VARS: readonly string[] = ["QCMS_INTERNAL_TOKEN"];

/**
 * Refuse to boot when a secret still holds an example-file placeholder (issue #491).
 *
 * ## Why this app needs its own copy of a guard the API already has
 *
 * Task 040 closed a HIGH finding by making the API refuse to boot on a placeholder:
 * every shipped example file fills its secrets with `replace-with-a-random-32-character-...`,
 * which is longer than the 32-character floor that was the only validation running, so a
 * half-configured deployment booted on key material published in a public repository.
 * That guard went into `apps/api/src/config.ts` only, deliberately, to keep the change out
 * of the browser-gated app trees.
 *
 * With the API refusing, a **composed** deployment does not come up at all, so this is not
 * a hole in the shipped stack - it is protected by the strictest reader. The reason to
 * close it anyway is the one the two apps' config modules keep supplying: "the other guy
 * validates it" is exactly the reasoning that produced #401 and #402, and a BFF started on
 * its own, or against an API someone relaxed, would present a published token and discover
 * it as an authentication failure at the first request rather than as a refusal at boot.
 * A boot refusal names the variable; a 401 does not.
 *
 * ## What it reports
 *
 * The variable name and nothing else. SEC-8 forbids echoing the value even when the value
 * is known to be worthless, because the same code path would handle a real one.
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

/** Public portal origin used for redirects produced inside the container. */
export function portalBaseUrl(): string {
  let base = required("QCMS_PORTAL_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/**
 * Whether the cookies **this app** sets carry the `Secure` attribute
 * (`QCMS_SECURE_COOKIES`, defaulting to `NODE_ENV === "production"`).
 *
 * Production is the safe default. Compose's documented localhost profile is the
 * deliberate exception: a plain-HTTP stack browsed somewhere a browser does not
 * treat as trustworthy could create a session and then fail to resume it after
 * Start, because the cookie would be dropped on the way back.
 *
 * Named for **what it decides** rather than for the environment it guesses from.
 * It was `isProduction()`, which invited the next caller who wanted a production
 * check for an unrelated reason and would have got a cookie policy instead
 * (issue #292 point 3); the admin's twin was renamed for the same reason in task
 * 056. The downgrade this returns is guarded by
 * {@link assertSecureCookiesConfigured}, which refuses to boot when it is asked
 * for at an origin a browser will not protect.
 *
 * Parsing is {@link boolEnv}, the strict shared contract the admin and the API
 * already use (issue #401). An unset or blank variable still defaults from
 * `NODE_ENV`; anything set but unparseable now throws by name rather than being
 * silently discarded.
 */
export function secureCookies(): boolean {
  return boolEnv("QCMS_SECURE_COOKIES", process.env.NODE_ENV === "production");
}

/**
 * Whether `host` is one a browser treats as **potentially trustworthy** even over
 * plain HTTP, and therefore one where dropping `Secure` costs nothing: there is no
 * network hop to eavesdrop on.
 *
 * The set is the Secure Contexts one (`localhost`, any `*.localhost` name,
 * `127.0.0.0/8`, `::1`), deliberately, because that specification is what decides
 * whether the browser on the other side will keep the cookie at all. Anything else
 * is a real network path.
 *
 * @param host a URL hostname, so IPv6 literals arrive bracketed (`[::1]`).
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
 * Refuse to boot when cookie security is downgraded at an origin that is not
 * loopback (issue #292 point 1).
 *
 * ## Why a refusal and not a warning
 *
 * `.env.compose.example` ships the downgrade and `README.md` tells an operator to
 * copy that file. An operator who then puts the stack behind the TLS ingress the
 * same README recommends carries the downgrade forward, and nothing complains: the
 * deployment looks right, serves HTTPS, and hands out a session cookie any hop on
 * the path can read. A log line does not reach that operator. A product that claims
 * security should fail loudly on an insecure configuration rather than ship a silent
 * downgrade, so this throws, and the message names the variable, what was observed,
 * and the remedy.
 *
 * ## What "off-loopback" is read from, and what that misses
 *
 * `QCMS_SECURE_COOKIES` describes the **browser-facing** scheme, which this process
 * cannot observe: it sees a container port, not the ingress in front of it. The one
 * thing the operator does declare about the browser-facing origin is
 * `QCMS_PORTAL_BASE_URL` - required, already parsed here, and already the address
 * the Start route sends a browser to. So that is the signal.
 *
 * It misses the deployment whose base URL is itself wrong (says `http://localhost`
 * while the site is served from a real hostname). That deployment is already broken
 * in a visible way - every redirect the portal emits points at the operator's own
 * loopback - so it is not a configuration this guard can be the first to notice. It
 * also permits `https://localhost` with the downgrade on, which is pointless rather
 * than dangerous.
 *
 * ## Where it runs
 *
 * `instrumentation.ts`, which Next calls once per server process before anything
 * serves, so the failure is a boot failure rather than a 500 on the first request.
 * It is deliberately NOT inside {@link secureCookies}: that reader is called on
 * request paths and in unit fixtures that set no base URL at all, and a guard that
 * fires there would be testing the harness rather than the deployment.
 *
 * A missing or unparseable base URL is passed rather than refused. It is a
 * different defect, `portalBaseUrl()` already fails loudly on it at the first
 * request, and `register()` also runs in build-time server workers where the
 * variable is legitimately absent.
 *
 * ## Twin
 *
 * `apps/admin/lib/server/config.ts` carries the same guard over
 * `QCMS_ADMIN_SECURE_COOKIES` and `QCMS_ADMIN_BASE_URL`. The two variables stay
 * separate on purpose (task 056: the admin origin's three cookie families must
 * agree with each other and with better-auth in the API, which is a different
 * question from the respondent portal's), but the *rule* must not drift - the two
 * apps disagreeing about exactly this is what issue #292 was filed about. There is
 * no shared package for a Next BFF's server code, so it is a copy. **Change one,
 * change the other** - and read that as the reminder it is, not as a guarantee.
 *
 * This used to claim that the `config.test.ts` matrices on both sides assert the same
 * cases, so a one-sided change goes red. Nothing computes that (issue #412), and the
 * two had already drifted when it was checked: the admin's matrix carried the raw
 * `0`/`no`/`off` spellings and the portal's did not, which is exactly the gap that let
 * the portal report `QCMS_SECURE_COOKIES is unset` for a variable that was set (issue
 * #409). An unenforced guarantee in a comment is worse than no comment, because it
 * stops the next reader checking. Making it real means a case table both suites
 * import, which needs a home for cross-app test fixtures that this repository does not
 * have yet; #412 holds that decision.
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
