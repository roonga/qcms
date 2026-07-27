/**
 * Server-only admin configuration (task 031).
 *
 * Everything here is read at request time on the server and MUST never reach the
 * client bundle: the database URL, the better-auth signing secret, the internal
 * API base URL, and the SEC-4 internal service token are all server secrets. The
 * R2 import-surface test enforces that no `"use client"` module imports this file
 * as a value.
 *
 * Nothing here echoes a value in an error message (SEC-8): a missing or too-short
 * secret is reported by env-var name and reason only.
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

/** Minimum length for the better-auth signing secret (SEC-7: >= 32 bytes). */
const MIN_SECRET_LENGTH = 32;

/** Minimum admin password length. SEC-1's strength check is issue-tracked. */
export const MIN_PASSWORD_LENGTH = 12;

/** Absolute admin-session lifetime in ms (SEC-1: 12h, configurable). */
const DEFAULT_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Idle admin-session timeout in ms (SEC-1: 1h, configurable). */
const DEFAULT_SESSION_IDLE_MS = 60 * 60 * 1000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required server env var ${name}`);
  }
  return value;
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

/** Cookies are `secure` in production only, so local http dev still works. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The admin app's own origin (`QCMS_ADMIN_BASE_URL`), which better-auth uses to
 * scope cookies and to build the TOTP issuer's account URI.
 */
export function adminBaseUrl(): string {
  let base = required("QCMS_ADMIN_BASE_URL");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

/**
 * The better-auth signing secret (`QCMS_ADMIN_AUTH_SECRET`). Rejected when short:
 * a secret that is present but weak is a misconfiguration, and the right time to
 * find out is boot, not first sign-in.
 */
export function authSecret(): string {
  const secret = required("QCMS_ADMIN_AUTH_SECRET");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`QCMS_ADMIN_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
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

/** Session lifetimes (SEC-1). Absolute wins: activity cannot extend it. */
export function sessionPolicy(): { readonly idleMs: number; readonly maxAgeMs: number } {
  return {
    idleMs: positiveIntEnv("QCMS_ADMIN_SESSION_IDLE_MS", DEFAULT_SESSION_IDLE_MS),
    maxAgeMs: positiveIntEnv("QCMS_ADMIN_SESSION_MAX_AGE_MS", DEFAULT_SESSION_MAX_AGE_MS),
  };
}
