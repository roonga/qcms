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
 * Minimum admin password length, mirrored from the API's `MIN_PASSWORD_LENGTH` (SEC-1's
 * strength check is issue-tracked, #178).
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
 */
export function secureCookies(): boolean {
  return boolEnv("QCMS_ADMIN_SECURE_COOKIES", process.env.NODE_ENV === "production");
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
