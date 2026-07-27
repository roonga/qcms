import { countAdminUsers } from "@qcms/db";
import type { Executor } from "@qcms/db";

import { auth } from "./auth.ts";
import { MIN_PASSWORD_LENGTH } from "./config.ts";

/**
 * First-run bootstrap: create the deployment's first admin (task 031, SEC-1).
 *
 * This is the **only** way an admin account comes into existence. There is no
 * self-registration route (see `lib/server/auth.ts` for why the better-auth catch-all
 * handler is not mounted), no invite flow, and no "first visitor becomes admin"
 * shortcut - which is the classic version of this feature and is a hole, because it
 * races anyone who can reach the URL before the operator does.
 *
 * The guard is instead a hard precondition: **zero** admin users. Not "no user with
 * this email", not "upsert": if any account exists, this refuses. That makes the
 * command safe to leave in a deployment runbook and safe to re-run by accident, and it
 * means the window in which it can create an account closes the moment the first one
 * exists. An operator who genuinely needs a second account today does it by
 * re-running against a fresh database or by adding the row deliberately; a
 * user-management screen is Phase 4 along with RBAC (R7).
 *
 * Password strength is checked as length only, matching the sign-in policy; SEC-1's
 * zxcvbn-style score is recorded as an issue rather than improvised here.
 *
 * The account is created **without** a session: `signUpEmail` issues one, and a
 * command-line bootstrap has no browser to give it to, so it is revoked immediately.
 * Leaving it would mean a live admin session whose token exists only in a CLI's
 * discarded response.
 *
 * 2FA is deliberately not enrolled here. Enrollment needs an authenticator app in the
 * operator's hands, so it happens on their first sign-in, which under the default
 * policy is enforced before the account can reach a single API route.
 */

/** Why a bootstrap attempt was refused. Every case is actionable by the operator. */
export type BootstrapRefusal =
  | { readonly kind: "already-bootstrapped"; readonly existingAdmins: number }
  | { readonly kind: "invalid-email" }
  | { readonly kind: "weak-password"; readonly minLength: number };

export type BootstrapResult =
  | { readonly ok: true; readonly userId: string; readonly email: string }
  | { readonly ok: false; readonly refusal: BootstrapRefusal };

/** A deliberately conservative shape check; the address is never emailed. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Create the first admin, or refuse with a reason. Takes the executor so the caller
 * (CLI or test) owns the connection, and so the zero-users check and the creation read
 * the same database the auth instance writes to.
 */
export async function createInitialAdmin(
  exec: Executor,
  input: { readonly email: string; readonly password: string; readonly name?: string },
): Promise<BootstrapResult> {
  const existingAdmins = await countAdminUsers(exec);
  if (existingAdmins > 0) {
    return { ok: false, refusal: { kind: "already-bootstrapped", existingAdmins } };
  }
  if (!looksLikeEmail(input.email)) {
    return { ok: false, refusal: { kind: "invalid-email" } };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, refusal: { kind: "weak-password", minLength: MIN_PASSWORD_LENGTH } };
  }

  const created = await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name ?? "Administrator" },
    asResponse: true,
  });
  const body = (await created.json()) as { user: { id: string; email: string } };

  // Revoke the session `signUpEmail` issued: a CLI has no browser to hand it to.
  const cookies = created.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (cookies.length > 0) {
    await auth.api.revokeSessions({ headers: new Headers({ cookie: cookies.join("; ") }) });
  }

  return { ok: true, userId: body.user.id, email: body.user.email };
}

/** A one-line, value-free explanation of a refusal, safe to print (SEC-8). */
export function describeRefusal(refusal: BootstrapRefusal): string {
  switch (refusal.kind) {
    case "already-bootstrapped":
      return `Refusing: this deployment already has ${refusal.existingAdmins} admin account(s). The bootstrap command only runs against an empty admin table.`;
    case "invalid-email":
      return "Refusing: QCMS_ADMIN_EMAIL is not a valid email address.";
    case "weak-password":
      return `Refusing: QCMS_ADMIN_PASSWORD must be at least ${refusal.minLength} characters.`;
  }
}
