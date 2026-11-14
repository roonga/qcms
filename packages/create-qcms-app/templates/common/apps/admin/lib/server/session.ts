/** Keep provisional-password replacement before enrollment so a factor cannot bind an account still holding its provisioning credential. Session reads must remain request-scoped. */
import { cache } from "react";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { proxiedSession } from "./auth-api.ts";
import { sessionMaxAgeMs, twoFactorOptional } from "./config.ts";
import { redirectAfterPost } from "./route-helpers.ts";

export interface AdminSession {
  readonly userId: string;
  readonly email: string;
  readonly name: string;

  readonly role: string | null;

  readonly twoFactorEnabled: boolean;
  /** This flag marks the provisioning credential; the API remains authoritative on every admin route. */
  readonly mustChangePassword: boolean;
  /** Server-only bearer credential forwarded on the admin-session header; never expose it to clients. */
  readonly token: string;
}

export const SIGN_IN_PATH = "/sign-in";
/** Keep this outside the shell layout gate or a provisional account would redirect to itself. */
export const CHANGE_PASSWORD_PATH = "/change-password";

export const ENROLL_PATH = "/two-factor/enroll";
/** Resolve home against caller areas: Operations-only users may have no authoring access. */
export const SHELL_HOME_PATH = "/";

/** React cache deduplicates session reads only within one render request, never across users or requests. Enrollment needs this reader before the 2FA gate; memoize reads, not redirects. */
export const currentAdminSession: () => Promise<AdminSession | undefined> = cache(
  async (): Promise<AdminSession | undefined> => {
    const requestHeaders = await headers();
    const result = await proxiedSession(requestHeaders);
    if (result === undefined) return undefined;

    const issuedAt = new Date(result.session.createdAt).getTime();
    if (Date.now() - issuedAt >= sessionMaxAgeMs()) return undefined;

    return {
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role ?? null,
      twoFactorEnabled: result.user.twoFactorEnabled === true,
      /** Absent flags avoid redirect loops for unmarked accounts; the API enforces the column on every admin route. */
      mustChangePassword: result.user.mustChangePassword === true,
      token: result.session.token,
    };
  },
);

type SessionOutcome =
  | { readonly session: AdminSession; readonly redirectTo?: undefined }
  | {
      readonly session?: undefined;
      readonly redirectTo: typeof SIGN_IN_PATH | typeof CHANGE_PASSWORD_PATH | typeof ENROLL_PATH;
    };

/** Share policy across page and handler guards. New routes outside the shell need explicit guards because neither its layout nor its structural test covers them. */
async function sessionOutcome(): Promise<SessionOutcome> {
  const session = await currentAdminSession();
  if (session === undefined) return { redirectTo: SIGN_IN_PATH };
  /** Change the provisioning password before binding a second factor. */
  if (session.mustChangePassword) return { redirectTo: CHANGE_PASSWORD_PATH };
  if (!session.twoFactorEnabled && !twoFactorOptional()) return { redirectTo: ENROLL_PATH };
  return { session };
}

/** For pages and actions: redirect throws. POST route handlers must use the 303 variant. */
export async function requireAdminSession(): Promise<AdminSession> {
  const outcome = await sessionOutcome();
  if (outcome.session === undefined) redirect(outcome.redirectTo);
  return outcome.session;
}

/** Next redirect produces 307 and would repost a credential to sign-in. Route handlers must return a 303 so the follow-up is GET. */
export async function requireAdminSessionForRequest(): Promise<AdminSession | Response> {
  const outcome = await sessionOutcome();
  return outcome.session ?? redirectAfterPost(outcome.redirectTo);
}

/** Skip completed-2FA gating for enrollment, but enforce password replacement first. Already-enrolled accounts cannot reprovision by visiting this URL. */
export async function requireEnrollingSession(): Promise<AdminSession> {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (session.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  if (session.twoFactorEnabled) redirect(SHELL_HOME_PATH);
  return session;
}

/** Apply the same provisional-password gate to POST handlers; a screen redirect alone cannot stop direct enrollment requests. */
export async function requireEnrollingSessionForRequest(): Promise<AdminSession | Response> {
  const session = await currentAdminSession();
  if (session === undefined) return redirectAfterPost(SIGN_IN_PATH);
  if (session.mustChangePassword) return redirectAfterPost(CHANGE_PASSWORD_PATH);
  if (session.twoFactorEnabled) return redirectAfterPost(SHELL_HOME_PATH);
  return session;
}

/** Only flagged sessions may use this change surface. Cleared accounts continue to enrollment or shell instead of gaining a second unguarded password path. */
export async function requirePasswordChangeSession(): Promise<AdminSession> {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (!session.mustChangePassword) {
    redirect(!session.twoFactorEnabled && !twoFactorOptional() ? ENROLL_PATH : SHELL_HOME_PATH);
  }
  return session;
}

/** Skip the gate that redirects provisional accounts to this path or the clearing handler would loop. Refuse POSTs with 303, never Next redirect 307. */
export async function requirePasswordChangeSessionForRequest(): Promise<AdminSession | Response> {
  const session = await currentAdminSession();
  if (session === undefined) return redirectAfterPost(SIGN_IN_PATH);
  if (!session.mustChangePassword) {
    return redirectAfterPost(
      !session.twoFactorEnabled && !twoFactorOptional() ? ENROLL_PATH : SHELL_HOME_PATH,
    );
  }
  return session;
}
