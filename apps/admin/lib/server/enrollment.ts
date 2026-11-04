import { cookies } from "next/headers";

import { secureCookies } from "./config.ts";

/** Provision the TOTP URI while the sign-in POST still holds the password; never retain the password for the next screen. URI and one-time codes cross the redirect in hardened, path-scoped, 15-minute cookies, deleted on completion. */

export const ENROLLMENT_COOKIE = "qcms_admin.enrollment";

export const RECOVERY_CODES_COOKIE = "qcms_admin.recovery_codes";

/** Fifteen minutes permits authenticator setup while bounding exposure of the pending secret. */
const ENROLLMENT_TTL_SECONDS = 15 * 60;

const COOKIE_PATH = "/two-factor";

/** Return Set-Cookie strings: cookies().set mutations do not attach to a hand-built redirect Response. */
function serialize(name: string, value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secureCookies()) attributes.push("Secure");
  return attributes.join("; ");
}

export function pendingEnrollmentCookie(totpUri: string): string {
  return serialize(ENROLLMENT_COOKIE, totpUri, ENROLLMENT_TTL_SECONDS);
}

export function clearEnrollmentCookie(): string {
  return serialize(ENROLLMENT_COOKIE, "", 0);
}

export function recoveryCodesCookie(codes: readonly string[]): string {
  return serialize(RECOVERY_CODES_COOKIE, JSON.stringify(codes), ENROLLMENT_TTL_SECONDS);
}

export function clearRecoveryCodesCookie(): string {
  return serialize(RECOVERY_CODES_COOKIE, "", 0);
}

export async function pendingEnrollment(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(ENROLLMENT_COOKIE)?.value;
}

/** Tampered or truncated code cookies behave like absence and redirect. Never log their contents. */
export async function owedRecoveryCodes(): Promise<string[] | undefined> {
  const jar = await cookies();
  const raw = jar.get(RECOVERY_CODES_COOKIE)?.value;
  if (raw === undefined || raw === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return parsed.every((code) => typeof code === "string") ? parsed : undefined;
}
