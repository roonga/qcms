/**
 * Server-only admin configuration (task 031; narrowed by task 056).
 *
 * Everything here is read at request time on the server and MUST never reach the
 * client bundle: the internal API base URL and the SEC-4 internal service token are
 * server secrets. The R2 import-surface test enforces that no `"use client"` module
 * imports this file as a value.
 *
 * Nothing here echoes a value in an error message (SEC-8): a missing or too-short
 * secret is reported by env-var name and reason only.
 *
 * Two values left in task 056, when better-auth moved into the API (ADR-35 as amended
 * 2026-07-31): `DATABASE_URL`, because the admin holds no database handle at all any
 * more, and `QCMS_ADMIN_AUTH_SECRET`, because nothing here signs or verifies a cookie -
 * the API does, and the admin only carries cookies past. `QCMS_ADMIN_BASE_URL` stays,
 * for the CSRF origin check below; the API reads it too, for better-auth's `baseURL`.
 */

/** The SEC-4 internal-token header the API requires on every call. */
export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

/**
 * The header the API's admin-auth middleware reads the admin's better-auth session
 * token from. Kept in lockstep with `ADMIN_SESSION_HEADER` in
 * `apps/api/src/middleware/admin-auth.ts`; it is a private contract between these
 * two processes, carried inside the already-token-gated internal channel.
 */
export const ADMIN_SESSION_HEADER = "x-qcms-admin-session";

/**
 * Minimum admin password length, mirrored from the API's `MIN_PASSWORD_LENGTH` (SEC-1).
 *
 * The length floor is the only password rule with a client-side hint. SEC-1's other
 * rule, the breach-corpus check (issue #178), has none by construction: answering
 * "is this password in the corpus" in the browser would mean sending it there, and the
 * check deliberately never leaves the API process.
 *
 * A duplicated constant rather than an import, because importing it would mean the admin
 * takes a value binding from `apps/api` and the two apps are separate deployables with
 * no shared package between them. It is used only for the `minlength` attribute on the
 * password fields, which is a hint: the API enforces the real rule and rejects anything
 * shorter, so a drift makes a form field permissive, never a password weak.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Absolute admin-session lifetime in ms (SEC-1: 12h, configurable). */
const DEFAULT_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required server env var ${name}`);
  }
  return value;
}

/**
 * A boolean env knob, accepting the **same spellings** as the API's `parseBool`
 * (`apps/api/src/config.ts`). That symmetry is the point rather than a nicety: an
 * operator who writes `QCMS_ADMIN_SECURE_COOKIES=off` must get the same answer out of
 * both processes, or the two cookie families disagree again in a way no test would show.
 */
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
 * Whether the cookies **this app** sets carry `Secure` (`QCMS_ADMIN_SECURE_COOKIES`,
 * defaulting to `NODE_ENV === "production"`).
 *
 * ## Why this is a knob and not `NODE_ENV`, and why the name changed
 *
 * Three cookie families are set for this origin, and they must agree, because a browser
 * that drops one of them breaks a flow rather than degrading it:
 *
 * 1. better-auth's session and two-factor cookies, set by the **API** since task 056 and
 *    decided there by `config.adminAuth.secureCookies`.
 * 2. The enrollment and recovery-view cookies (`lib/server/enrollment.ts`).
 * 3. The appearance/mode cookie the shell's menu writes (`app/(shell)/layout.tsx`).
 *
 * Task 056 introduced `QCMS_ADMIN_SECURE_COOKIES` for family 1 while families 2 and 3
 * still read `NODE_ENV` directly, and that split is a real lockout rather than an
 * inconsistency: `docker/admin.Dockerfile` bakes `NODE_ENV=production` into the image, so
 * in the plain-HTTP non-loopback shape `.env.compose.example` documents (knob `false`) the
 * session cookie would lose `Secure` and be kept while `qcms_admin.enrollment` would keep
 * it and be dropped - and enroll then redirects to sign-in, which redirects back to
 * enroll, forever. Before 056 both families keyed off one `isProduction()` and therefore
 * could not disagree.
 *
 * So all three now read this, and the function is named for **what it decides** rather
 * than for the environment it used to guess from: `isProduction()` invited exactly the
 * next caller who wanted a production check for an unrelated reason and got a cookie
 * policy instead. A `Secure` attribute is not a session-policy semantic, which is why
 * this sits outside the "no session-policy changes" fence task 056 carries.
 *
 * Default preserved: with the variable unset the answer is what `isProduction()` returned.
 * Also closes issue #292 point 3.
 *
 * The downgrade this returns is guarded by {@link assertSecureCookiesConfigured}, which
 * refuses to boot when it is asked for at an origin a browser will not protect.
 */
export function secureCookies(): boolean {
  return boolEnv("QCMS_ADMIN_SECURE_COOKIES", process.env.NODE_ENV === "production");
}

/**
 * Whether `host` is one a browser treats as **potentially trustworthy** even over plain
 * HTTP, and therefore one where dropping `Secure` costs nothing: there is no network hop
 * to eavesdrop on.
 *
 * The set is the Secure Contexts one (`localhost`, any `*.localhost` name, `127.0.0.0/8`,
 * `::1`), deliberately, because that specification is what decides whether the browser on
 * the other side will keep the cookie at all. Anything else is a real network path.
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
 * Refuse to boot when cookie security is downgraded at an origin that is not loopback
 * (issue #292 point 1).
 *
 * ## Why a refusal and not a warning
 *
 * `.env.compose.example` ships the portal's downgrade and `README.md` tells an operator
 * to copy that file; the note beside this app's flag has, until now, told the same
 * operator to set it false for a plain-HTTP non-loopback admin. Both roads end at a
 * deployment that looks right and hands out a credential-bearing cookie any hop on the
 * path can read - and on this origin that cookie is an authoring session with 2FA behind
 * it. A log line does not reach that operator. So this throws, and the message names the
 * variable, what was observed, and the remedy.
 *
 * The plain-HTTP non-loopback admin is therefore no longer a supported shape. It was only
 * ever reachable by turning `Secure` off, which is the thing being refused; the remedy is
 * TLS, or reaching the admin over a loopback address (an SSH tunnel or a port-forward),
 * which is what the enterprise topology's VPN placement already assumes.
 *
 * ## What "off-loopback" is read from, and what that misses
 *
 * `QCMS_ADMIN_SECURE_COOKIES` describes the **browser-facing** scheme, which this process
 * cannot observe: it sees a container port, not the ingress in front of it. The one thing
 * the operator does declare about the browser-facing origin is `QCMS_ADMIN_BASE_URL` -
 * required, already parsed here for the SEC-9 origin check, and already the origin
 * better-auth in the API scopes its cookies to. So that is the signal.
 *
 * It misses the deployment whose base URL is itself wrong (says `http://localhost` while
 * the site is served from a real hostname). That deployment is already broken in a
 * visible way - the CSRF origin check rejects every state-changing POST - so it is not a
 * configuration this guard can be the first to notice. It also permits `https://localhost`
 * with the downgrade on, which is pointless rather than dangerous.
 *
 * It also does not reach the **API** process, which reads the same variable for
 * better-auth's own cookies (`apps/api/src/config.ts`). Refusing here is enough to stop
 * the shape, because the browser cannot reach better-auth except through this BFF (R2)
 * and this BFF will not start; extending the refusal into the API's issue-collecting
 * config parser is a separate change with its own fixture surface.
 *
 * ## Where it runs
 *
 * `instrumentation.ts`, which Next calls once per server process before anything serves,
 * so the failure is a boot failure rather than a 500 on the first request. It is
 * deliberately NOT inside {@link secureCookies}: that reader is called on request paths
 * and in unit fixtures that set no base URL at all, and a guard that fires there would be
 * testing the harness rather than the deployment.
 *
 * A missing or unparseable base URL is passed rather than refused. It is a different
 * defect, `adminBaseUrl()` already fails loudly on it at the first request, and
 * `register()` also runs in build-time server workers where the variable is legitimately
 * absent.
 *
 * ## Twin
 *
 * `apps/portal/lib/server/config.ts` carries the same guard over `QCMS_SECURE_COOKIES`
 * and `QCMS_PORTAL_BASE_URL`. The two variables stay separate on purpose (see
 * {@link secureCookies} above), but the *rule* must not drift - the two apps disagreeing
 * about exactly this is what issue #292 was filed about. There is no shared package for a
 * Next BFF's server code, the same call `MIN_PASSWORD_LENGTH` above makes, so it is a
 * copy, and the test matrices in
 * `config.test.ts` on both sides assert the same cases so a change made to one and not
 * the other shows up as a red test. **Change one, change the other.**
 */
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

/**
 * The authoring app's own public origin (`QCMS_ADMIN_BASE_URL`).
 *
 * Read here for the CSRF origin check on every state-changing POST (SEC-9). The API
 * reads the same variable for better-auth's `baseURL` and `trustedOrigins`, so the two
 * sides agree on what "this app's origin" means by construction rather than by
 * convention.
 */
export function adminBaseUrl(): string {
  let base = required("QCMS_ADMIN_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/**
 * The 2FA policy (SEC-1). `required` is the default and the only supported
 * production value; `optional` is the documented development escape hatch and lets
 * an admin skip TOTP enrollment entirely. The API reads the same env var, so a
 * deployment that relaxes it here without relaxing it there simply cannot call the
 * API - the two sides fail closed rather than diverge silently.
 */
export function twoFactorPolicy(): "required" | "optional" {
  const raw = process.env.QCMS_ADMIN_2FA?.trim();
  if (raw === undefined || raw === "") return "required";
  if (raw === "required" || raw === "optional") return raw;
  throw new Error("QCMS_ADMIN_2FA must be `required` or `optional`");
}

/** Whether TOTP enrollment may be skipped (development escape hatch, SEC-1). */
export function twoFactorOptional(): boolean {
  return twoFactorPolicy() === "optional";
}

/**
 * The absolute admin-session lifetime in ms (SEC-1: 12h, configurable).
 *
 * The **idle** window is better-auth's, and since task 056 it is configured where the
 * library lives (the API reads `QCMS_ADMIN_SESSION_IDLE_MS`). What the admin still
 * measures itself is the absolute cap, because gate 2 of the shell's session policy has
 * to redirect with an "expired" marker and only this app can render that. Keep it in
 * step with the API's value: the two sides fail closed rather than diverge silently -
 * whichever is shorter wins, and neither can extend the other.
 */
export function sessionMaxAgeMs(): number {
  return positiveIntEnv("QCMS_ADMIN_SESSION_MAX_AGE_MS", DEFAULT_SESSION_MAX_AGE_MS);
}
