import {
  SEED_WORKSPACE_NAME,
  SEED_WORKSPACE_SLUG,
  addAccessGroupHolder,
  countAdminUsers,
  createAccessGroup,
  listWorkspaces,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import type { AdminAuth } from "./instance.js";
import {
  BREACH_LOOKUP_FAILED_CODE,
  BREACH_LOOKUP_FAILED_MESSAGE,
  BREACH_LOOKUP_OPERATOR_GUIDANCE,
  CORPUS_HIT_CODE,
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
 * **The credential this sets is provisional, and the account is marked as such**
 * (task 061, SEC-1). It arrives from a shell command, a provisioning script, a CI
 * variable or an operator's terminal history, and the person who ends up using the
 * account typically did not choose it. `instance.ts` declares
 * `user.mustChangePassword` to better-auth with `defaultValue: true`, so the flag is
 * written by the `signUpEmail` call below rather than by a line here: there is no
 * "remember to set it" step, and any future account-creation path inherits the
 * marking instead of opting into it. A successful password change clears it, and
 * nothing else does.
 *
 * 2FA is deliberately not enrolled here. Enrollment needs an authenticator app in the
 * operator's hands, so it happens on their first sign-in, which under the default
 * policy is enforced before the account can reach a single API route - and **after**
 * the forced password change, because enrolling a second factor binds it to an
 * account whose credential is still the provisional one (task 061).
 *
 * `signUpEmail` and `revokeSessions` are called **in process**, not over the auth
 * mount, and that is the point rather than a convenience: sign-up is not on the
 * mount's allowlist, so it is not reachable over HTTP in any composition. A CLI is not
 * HTTP-reachable, which is the distinction SEC-1 draws.
 *
 * **It also seeds the installation's first workspace** (ADR-41, task 068). A form and a
 * question each belong to exactly one workspace, enforced by a `NOT NULL` column
 * (criterion 1), so a bootstrapped installation with no workspace is one nothing can be
 * authored in. The seed runs here because this is the act that brings the first account
 * into existence, and ADR-41 requires the workspace to be attributed to it: the
 * server-side `createOrganization` with an explicit `userId` writes the organisation row
 * **and** the `member` row carrying `forms.owner`, where the request-scoped form has no
 * user to attribute anything to. The two-person switch is **off** on it, by the field's
 * declared default (Q13): an installation with one administrator cannot satisfy that rule
 * at all, so defaulting it on would teach the feature by teaching how to switch it off.
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
  | { readonly kind: "sign-up-rejected"; readonly status: number; readonly detail: string }
  /**
   * The account was created and the first workspace was not (task 068).
   *
   * Its own kind, because the recovery is different from every other refusal here: the
   * account exists, so re-running the command is refused as already-bootstrapped, and
   * what the operator needs is to create the workspace through
   * `POST /admin/workspaces` once the API is up. Reporting this as a generic failure
   * would send them looking for an account that is already there.
   */
  | { readonly kind: "workspace-seed-failed"; readonly email: string; readonly detail: string };

export type BootstrapResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly email: string;
      /** The workspace this installation was seeded with, or the one it already had. */
      readonly workspaceId: string;
      /** The workspace's slug, for the line the command prints. */
      readonly workspaceSlug: string;
    }
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
  if (body.code === CORPUS_HIT_CODE) return { kind: "compromised-password" };
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

  // The first workspace, attributed to the account just created (task 068, ADR-41).
  try {
    const workspace = await seedFirstWorkspace(auth, exec, body.user.id);
    return {
      ok: true,
      userId: body.user.id,
      email: body.user.email,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
    };
  } catch (error) {
    return {
      ok: false,
      refusal: {
        kind: "workspace-seed-failed",
        email: body.user.email,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * The installation's first workspace, created through better-auth's **server-side**
 * `createOrganization` with an explicit `userId` (ADR-41, task 068).
 *
 * The `userId` form is the whole reason this is not the request-scoped call: the seed runs
 * from a command line with nobody signed in, and the plugin treats a call with no session
 * and an explicit `userId` as a system action - which is also what lets it through
 * `allowUserToCreateOrganization: false`, the guard that stops an administrator making
 * workspaces by signing in. The same call writes the `member` row whose role is
 * `forms.owner` (the plugin's `creatorRole`), so the workspace never exists without an
 * owner, and the organisation's own fields take their declared defaults: not shared, not
 * archived, and the two-person switch **off** (Q13).
 *
 * **Idempotent by inspection rather than by conflict handling.** An installation that
 * already has a workspace keeps it: this is the first-run path, so the only way to reach
 * it with a workspace already present is a database somebody has worked on, and adopting
 * what is there is better than adding a second one beside it.
 */
async function seedFirstWorkspace(
  auth: AdminAuth,
  exec: Executor,
  userId: string,
): Promise<{ id: string; slug: string }> {
  const existing = await listWorkspaces(exec);
  const first = existing[0];
  if (first !== undefined) return { id: first.id, slug: first.slug };

  const created = await auth.api.createOrganization({
    body: { name: SEED_WORKSPACE_NAME, slug: SEED_WORKSPACE_SLUG, userId },
  });
  await seedFirstAdminGrants(exec, created.id, userId);
  return { id: created.id, slug: created.slug };
}

/**
 * The access groups the first administrator is seeded with (task 069).
 *
 * # Why a bootstrapped installation needs them at all
 *
 * From ADR-41 the installation-wide claim **administers and authorises nothing inside a
 * workspace** (Q29): authoring needs a `forms.` grant in that form's workspace, and
 * `forms.owner` - which `createOrganization` puts on the member row above - touches no
 * form, release, link, webhook or response row at all. So an installation seeded with the
 * claim and the owner row alone is one whose single administrator can administer the
 * workspace and **cannot author in it**.
 *
 * That is correct as a model and wrong as a first run. A bootstrapped deployment has one
 * account, and Q13 already rules on this shape once - the two-person switch defaults off
 * precisely because "an installation with one administrator cannot satisfy the rule at
 * all, so defaulting it on would teach an operator the feature by teaching them to switch
 * it off". The same reasoning reaches here: a first run that cannot create a form teaches
 * nothing except how to get round the model.
 *
 * # What is seeded and what is not
 *
 * **Seeded:** `all.forms.editor` and `all.forms.approver`, so the first administrator can
 * draft, publish, release, close, mint a link and configure an endpoint, in every
 * environment, exactly as they could before this task.
 *
 * **Not seeded:** any `responses.*` grant. Reading, exporting and erasing response data
 * stays a **deliberate act** somebody performs and the audit records (Q29, Q56, Q57): the
 * first administrator grants it to themselves through the membership screen, which with
 * the two-person switch off is allowed and audited, and which is what keeps a one-account
 * installation able to read its own responses without that access being something nobody
 * chose.
 *
 * Each seeded group is an **ordinary visible access group** in the list, with its own
 * name, role and scope (finding 17's rule that a convenience is never an implication), so
 * an operator can read what their account holds and revoke either one.
 *
 * # One audit row per seeded group
 *
 * The first version wrote none, on the reading that a seed is not an act somebody
 * performed. The Code Owner ruled the other way (Code Owner, 2026-10-18, PR #1061):
 * **Q56's "every grant write is a SEC-15 row" is meant literally**, so the seed writes one
 * `grant` row per group with the created account as actor and a detail that says
 * `qcms:create-admin` seeded it.
 *
 * It costs one insert and it keeps the first page of the audit honest: an operator reading
 * the log sees where the account's two groups came from, rather than finding two grants
 * nobody granted and having to know that the bootstrap is the answer. The actor is the
 * created account because it is the account the grants are for and the only identity the
 * installation has; the detail is what says it was the command and not that account.
 *
 * Q61's columns apply as they do to any grant row: the scope goes in `detail`, and
 * `environment` and `form` stay empty because the act names neither.
 */
async function seedFirstAdminGrants(
  exec: Executor,
  workspaceId: string,
  userId: string,
): Promise<void> {
  for (const role of SEEDED_FIRST_ADMIN_ROLES) {
    const name = `all.${role}`;
    const group = await createAccessGroup(exec, {
      workspaceId,
      name,
      role,
      environments: ["all"],
      forms: ["all"],
    });
    await addAccessGroupHolder(exec, group.teamId, userId);
    await writeAccessAuditRow(exec, {
      actor: userId,
      workspaceId,
      kind: "grant",
      detail: `${SEED_AUDIT_DETAIL_PREFIX} group=${name} role=${role} environments=all forms=all`,
    });
  }
}

/**
 * What a seeded `grant` row's detail begins with, so a reader and a test can both tell a
 * seeded grant from one somebody performed through the membership screen.
 */
export const SEED_AUDIT_DETAIL_PREFIX = "seeded by qcms:create-admin";

/**
 * The roles the first administrator is seeded with: the authoring family, and no
 * `responses.*` grant.
 *
 * **Accepted as built** (Code Owner, 2026-10-18, PR #1061), with the two consequences the
 * review named stated rather than left implicit: the scope is `all`, which for
 * `forms.approver` includes `prod`, so the first account can release to production alone -
 * the single-administrator case Q13 already accepts; and no response data is readable until
 * somebody grants it, which is Q29's deliberate act.
 *
 * Exported so the bootstrap's own test asserts the list rather than restating it, and so
 * the absence of a response grant is a thing a reader can see. That test is
 * `bootstrap.integration.test.ts`'s "the first administrator's seeded grants" block, which
 * the first version of this comment promised and did not have (PR #1061's review, S4).
 */
export const SEEDED_FIRST_ADMIN_ROLES: readonly string[] = ["forms.editor", "forms.approver"];

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
      // Both halves, because a command line IS the operator's channel (issue #910). The
      // API's 503 body carries only the first sentence and names no variable; this is
      // where the variable belongs, beside the other two `QCMS_ADMIN_*` names above.
      return `Refusing: ${BREACH_LOOKUP_FAILED_MESSAGE} ${BREACH_LOOKUP_OPERATOR_GUIDANCE}`;
    case "workspace-seed-failed":
      return (
        `Created the admin account for ${refusal.email}, but could not seed the first ` +
        `workspace (${refusal.detail}). The account exists, so re-running this command ` +
        "is refused; create the workspace with POST /admin/workspaces once the API is up."
      );
    case "sign-up-rejected":
      return (
        `Refusing: creating the account failed with HTTP ${refusal.status} (${refusal.detail}). ` +
        "This is not the SEC-1 breach check: an unreachable corpus reports itself " +
        "explicitly and names the network."
      );
  }
}
