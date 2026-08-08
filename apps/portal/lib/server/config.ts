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
 */
export function secureCookies(): boolean {
  const configured = process.env.QCMS_SECURE_COOKIES;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
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
 * no shared package for a Next BFF's server code, so it is a copy, and the test
 * matrices in `config.test.ts` on both sides assert the same cases so a change made
 * to one and not the other shows up as a red test. **Change one, change the other.**
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
  // whole job of this line is to say which variable to check. Quoted verbatim and
  // untrimmed on purpose: this reader compares the raw value, so `" true"` with a
  // stray space is exactly the case where seeing what was read is the answer.
  //
  // This changes only what the message says, never what the reader accepts. Whether
  // the portal should recognise `off`/`0`/`no` the way the admin's `boolEnv` does is
  // issue #401, and that is not decided here.
  const raw = process.env.QCMS_SECURE_COOKIES;
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
