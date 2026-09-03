/**
 * Which sentence a refused password change gets to say (issue #437).
 *
 * ## The default is one generic sentence, and that is not being relaxed
 *
 * Every auth failure in this app reports the same opaque marker, because SEC-1 requires
 * a wrong password and an unknown account to be indistinguishable: a change-password form
 * that said "your current password is wrong" would be a password-checking oracle for
 * anyone holding a session. `route-helpers.ts` states that rule at the redirect and the
 * catalog states it at the string. Nothing here changes it. What this module adds is one
 * named exception, ruled on rather than assumed.
 *
 * ## The exception, and what it costs
 *
 * `PASSWORD_COMPROMISED` is the code better-auth's `haveIBeenPwned` plugin answers when
 * the NEW password appears in the public breach corpus (SEC-1's check, issue #178). It
 * leaks nothing about the account: it is a statement about a password the submitter just
 * typed and already holds. An admin told only "something was wrong" cannot tell it from a
 * mistyped current password, and the likely response is to retype the same compromised
 * password more carefully, which is the failure this exists to end.
 *
 * The Code Owner ruled on 2026-09-03, taking option (a) of three put on issue #437, and
 * the cost is recorded because it is real rather than absent. better-auth 1.7.2 hashes
 * the new password - which is where the corpus check hooks - BEFORE it verifies the
 * current one: `dist/api/routes/update-user.mjs:174` is
 * `ctx.context.password.hash(newPassword)` and `:175-178` is the `password.verify` of
 * `currentPassword` that follows it. A Docker-backed probe on issue #437 confirmed the
 * refusal comes back byte-identically whether the supplied current password is right or
 * wrong, and the two lines were re-read at this version. So this copy is visible to any session
 * holder regardless of whether they know the current password: a corpus-membership
 * oracle for arbitrary candidates. It was accepted knowingly, because the corpus is
 * pwnedpasswords, a free public API anyone may query anonymously - the oracle duplicates
 * information already available at the source, so the marginal leak is effectively nil
 * while the gain for a legitimate admin is real. `docs/SECURITY_DESIGN.md` carries the
 * acceptance in its password section.
 *
 * Rejected alternatives, so neither is re-proposed as an improvement: pre-verifying the
 * current password before the change call (an extra round trip, or an upstream vendor
 * reorder, buying the closure of an oracle whose contents are public), and keeping the
 * generic failure (the gap the issue exists for).
 *
 * ## Display only
 *
 * Nothing here changes what the API refuses, when it refuses it, or in what order. This
 * is the admin choosing a sentence for a code it was already being sent, which is the
 * pattern issue #743 established for the portal's `UNSUPPORTED_SEMANTICS_VERSION` screen:
 * a mapping and a catalog entry at the surface, no API change, no policy change (R2).
 */

/**
 * The code better-auth puts in the body of the 400 it answers a corpus hit with.
 *
 * Duplicated from `apps/api/src/features/auth/instance.ts`'s `CORPUS_HIT_CODE` rather
 * than imported, for the reason the cookie names beside it are: the two apps are separate
 * deployables with no shared package, so a wire contract between them is written down on
 * both sides. It is the plugin's `$ERROR_CODES` entry - a code, not the vendor's prose,
 * which the vendor may reword.
 */
export const PASSWORD_COMPROMISED_CODE = "PASSWORD_COMPROMISED";

/** Which message the change-password surface renders for a refusal. */
export type PasswordRefusal = "compromised" | "generic";

/**
 * Read a refusal body and decide which sentence it earns.
 *
 * Total over unknown input, and generic for everything it does not recognise. That
 * direction is the safe one and it is the direction SEC-1 asks for: a body this cannot
 * parse, a code it has never seen, a proxy's HTML error page, all fall back to the
 * message that distinguishes nothing. Only the exact ruled code opts out.
 */
export function passwordRefusalOf(body: unknown): PasswordRefusal {
  if (typeof body !== "object" || body === null) return "generic";
  const { code } = body as { code?: unknown };
  return code === PASSWORD_COMPROMISED_CODE ? "compromised" : "generic";
}

/**
 * The same decision, over the `Response` the API's better-auth mount hands back.
 *
 * The mount forwards `auth.handler`'s own response, so the body arrives as the library
 * wrote it: `{ code, message }` at the top level. A body that is not JSON is swallowed
 * rather than thrown, because a refusal that cannot be parsed still has to render a
 * message, and the generic one is always a true thing to say.
 *
 * Only ever called on a response already known to be a refusal, so it never consumes the
 * body of a success whose `Set-Cookie` headers the caller still needs.
 */
export async function passwordRefusalFrom(response: Response): Promise<PasswordRefusal> {
  const body: unknown = await response.json().catch(() => undefined);
  return passwordRefusalOf(body);
}
