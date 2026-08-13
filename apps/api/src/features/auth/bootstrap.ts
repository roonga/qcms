import { countAdminUsers } from "@qcms/db";
import type { Executor } from "@qcms/db";

import type { AdminAuth } from "./instance.js";
import {
  BREACH_LOOKUP_FAILED_CODE,
  BREACH_LOOKUP_FAILED_MESSAGE,
  COMPROMISED_PASSWORD_CODE,
  MIN_PASSWORD_LENGTH,
} from "./instance.js";

/**
 * First-run bootstrap: create the deployment's first admin (task 031, SEC-1; moved
 * into the API by task 056 along with the better-auth instance it drives).
 *
 * This is the **only** way an admin account comes into existence. There is no
 * self-registration route (`route.ts` explains why the endpoint allowlist has no
 * sign-up entry), no invite flow, and no "first visitor becomes admin" shortcut -
 * which is the classic version of this feature and is a hole, because it races anyone
 * who can reach the URL before the operator does.
 *
 * The guard is instead a hard precondition: **zero** admin users. Not "no user with
 * this email", not "upsert": if any account exists, this refuses. That makes the
 * command safe to leave in a deployment runbook and safe to re-run by accident, and it
 * means the window in which it can create an account closes the moment the first one
 * exists. An operator who genuinely needs a second account today does it by
 * re-running against a fresh database or by adding the row deliberately; a
 * user-management screen is Phase 4 along with RBAC (R7).
 *
 * Password policy is the sign-in policy, applied at the same two levels: a length
 * floor checked here before anything is written, and the SEC-1 breach-corpus check
 * that better-auth's `haveIBeenPwned` plugin runs inside `signUpEmail` (issue #178).
 * The second one is why this function inspects the response status instead of
 * assuming success: a corpus hit comes back `400 PASSWORD_COMPROMISED` and an
 * unreachable corpus `503 BREACH_CORPUS_UNREACHABLE` (`instance.ts` relabels the
 * vendor's opaque 500, issue #436), and both have to reach the operator as a refusal
 * they can act on rather than as a crash reading `user.id` off an error body.
 *
 * There is no length rule *and* no composition rule beyond that floor, deliberately:
 * NIST SP 800-63B Rev 4 section 3.1.1.2 says a verifier SHALL NOT impose composition
 * rules and SHALL check the blocklist, which is exactly this split.
 *
 * The account is created **without** a session: `signUpEmail` issues one, and a
 * command-line bootstrap has no browser to give it to, so it is revoked immediately.
 * Leaving it would mean a live admin session whose token exists only in a CLI's
 * discarded response.
 *
 * 2FA is deliberately not enrolled here. Enrollment needs an authenticator app in the
 * operator's hands, so it happens on their first sign-in, which under the default
 * policy is enforced before the account can reach a single API route.
 *
 * `signUpEmail` and `revokeSessions` are called **in process**, not over the auth
 * mount, and that is the point rather than a convenience: sign-up is not on the
 * mount's allowlist, so it is not reachable over HTTP in any composition. A CLI is not
 * HTTP-reachable, which is the distinction SEC-1 draws.
 */

/** Why a bootstrap attempt was refused. Every case is actionable by the operator. */
export type BootstrapRefusal =
  | { readonly kind: "already-bootstrapped"; readonly existingAdmins: number }
  | { readonly kind: "invalid-email" }
  | { readonly kind: "weak-password"; readonly minLength: number }
  /** The password is in the public breach corpus (SEC-1, better-auth's plugin). */
  | { readonly kind: "compromised-password" }
  /**
   * The breach-corpus lookup could not be completed, so the password was refused
   * without being checked (issue #436). A distinct kind rather than a hedge inside
   * the catch-all below, because these two are the opposite diagnosis: this one says
   * "the network is down", the other says "something else went wrong and here is
   * what it said". `instance.ts` earns the distinction without matching on vendor
   * prose; see `explainBreachLookupFailure`.
   */
  | { readonly kind: "breach-corpus-unreachable" }
  /**
   * Any other non-2xx from `signUpEmail`, carrying the vendor's own status and
   * message. Both are safe to surface: neither carries the credential (SEC-8).
   */
  | { readonly kind: "sign-up-rejected"; readonly status: number; readonly detail: string };

export type BootstrapResult =
  | { readonly ok: true; readonly userId: string; readonly email: string }
  | { readonly ok: false; readonly refusal: BootstrapRefusal };

/**
 * A deliberately conservative shape check; the address is never emailed, so this only
 * has to catch a typo like a missing `@`, not implement RFC 5322.
 *
 * Written with string operations rather than the obvious `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`,
 * which pairs unbounded quantifiers around a literal and is therefore super-linear on
 * a crafted input - a real (if small) denial-of-service shape on a value that arrives
 * from outside, and one the lint gate rejects.
 */
function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local === undefined || local === "" || domain === undefined) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label !== "");
}

/**
 * Turn a non-2xx `signUpEmail` response into a refusal, without ever reading the
 * request that produced it. The body is better-auth's `{ message, code }`; a response
 * that is not JSON at all still has to become a refusal rather than a throw, because
 * the caller is a CLI whose whole job is to print one actionable line.
 */
async function refusalFor(response: Response): Promise<BootstrapRefusal> {
  const body = (await response.json().catch(() => ({}))) as {
    code?: unknown;
    message?: unknown;
  };
  if (body.code === COMPROMISED_PASSWORD_CODE) return { kind: "compromised-password" };
  if (body.code === BREACH_LOOKUP_FAILED_CODE) return { kind: "breach-corpus-unreachable" };
  return {
    kind: "sign-up-rejected",
    status: response.status,
    detail: typeof body.message === "string" ? body.message : "no message",
  };
}

/**
 * Create the first admin, or refuse with a reason.
 *
 * Takes the auth instance and the executor so the caller (CLI or test) owns the
 * connection, and so the zero-users check and the creation read the same database the
 * auth instance writes to.
 */
export async function createInitialAdmin(
  auth: AdminAuth,
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
  if (!created.ok) return { ok: false, refusal: await refusalFor(created) };
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
    case "compromised-password":
      return (
        "Refusing: QCMS_ADMIN_PASSWORD appears in the public breach corpus at " +
        "api.pwnedpasswords.com (SEC-1). Choose a different password; a longer " +
        "passphrase you have never used elsewhere is the reliable fix."
      );
    case "breach-corpus-unreachable":
      return `Refusing: ${BREACH_LOOKUP_FAILED_MESSAGE}`;
    case "sign-up-rejected":
      return (
        `Refusing: creating the account failed with HTTP ${refusal.status} (${refusal.detail}). ` +
        "This is not the SEC-1 breach check: an unreachable corpus reports itself " +
        "explicitly and names the network."
      );
  }
}
