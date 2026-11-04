import { cookies } from "next/headers";

import { authApiFetch } from "./api.ts";

/** Forward named auth operations over the internal channel; credentials never pass through client JavaScript. Copy Set-Cookie headers verbatim onto the admin redirect. */

/** Cookie names mirror the API wire contract across separate deployables; the admin reads them and never rewrites vendor attributes. */
const COOKIE_PREFIX = "qcms_admin";

export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;

export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;

export async function readAuthCookie(unprefixedName: string): Promise<string | undefined> {
  const jar = await cookies();
  const exact = jar.get(unprefixedName)?.value;
  if (exact !== undefined) return exact;
  return jar.getAll().find((cookie) => cookie.name.endsWith(`-${unprefixedName}`))?.value;
}

export interface ProxiedSession {
  readonly session: {
    readonly token: string;

    readonly createdAt: string;
  };
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;

    readonly role?: string;
    readonly twoFactorEnabled?: boolean;
    /** Absent flags read as false to avoid redirect loops with unmarked accounts. The API enforces the provisional-password gate against its own column on every admin route. */
    readonly mustChangePassword?: boolean;
  };
}

/** better-auth returns 200 with null for no session; that is absence, not an API failure. */
export async function proxiedSession(requestHeaders: Headers): Promise<ProxiedSession | undefined> {
  const response = await authApiFetch("/get-session", { from: requestHeaders });
  if (!response.ok) return undefined;
  const body = (await response.json()) as ProxiedSession | null;
  if (body === null) return undefined;
  return body;
}

export function signInEmail(
  requestHeaders: Headers,
  credentials: { readonly email: string; readonly password: string },
): Promise<Response> {
  return authApiFetch("/sign-in/email", {
    method: "POST",
    body: credentials,
    from: requestHeaders,
  });
}

export function signOut(requestHeaders: Headers): Promise<Response> {
  return authApiFetch("/sign-out", { method: "POST", body: {}, from: requestHeaders });
}

export function enableTwoFactor(
  requestHeaders: Headers,
  password: string,
  cookie: string,
): Promise<Response> {
  const headers = new Headers(requestHeaders);
  headers.set("cookie", cookie);
  return authApiFetch("/two-factor/enable", { method: "POST", body: { password }, from: headers });
}

export function verifyTotp(requestHeaders: Headers, code: string): Promise<Response> {
  return authApiFetch("/two-factor/verify-totp", {
    method: "POST",
    body: { code },
    from: requestHeaders,
  });
}

export function verifyBackupCode(requestHeaders: Headers, code: string): Promise<Response> {
  return authApiFetch("/two-factor/verify-backup-code", {
    method: "POST",
    body: { code },
    from: requestHeaders,
  });
}

export function generateBackupCodes(requestHeaders: Headers, password: string): Promise<Response> {
  return authApiFetch("/two-factor/generate-backup-codes", {
    method: "POST",
    body: { password },
    from: requestHeaders,
  });
}

export function changePassword(
  requestHeaders: Headers,
  passwords: { readonly currentPassword: string; readonly newPassword: string },
): Promise<Response> {
  return authApiFetch("/change-password", {
    method: "POST",
    body: { ...passwords, revokeOtherSessions: true },
    from: requestHeaders,
  });
}
