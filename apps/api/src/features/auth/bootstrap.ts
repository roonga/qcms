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

export type BootstrapRefusal =
  | { readonly kind: "already-bootstrapped"; readonly existingAdmins: number }
  | { readonly kind: "invalid-email" }
  | { readonly kind: "weak-password"; readonly minLength: number }
  | { readonly kind: "compromised-password" }
  | { readonly kind: "breach-corpus-unreachable" }
  /** The vendor status and message are safe to surface: neither carries the credential (SEC-8). */
  | { readonly kind: "sign-up-rejected"; readonly status: number; readonly detail: string }
  | { readonly kind: "workspace-seed-failed"; readonly email: string; readonly detail: string };

export type BootstrapResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly email: string;
      readonly workspaceId: string;
      readonly workspaceSlug: string;
    }
  | { readonly ok: false; readonly refusal: BootstrapRefusal };

/** String operations, not a regex: the obvious email pattern is super-linear on crafted input. */
function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local === undefined || local === "" || domain === undefined) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label !== "");
}

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
 * better-auth treats `createOrganization` with no session and an explicit `userId` as a
 * system action, which is what gets the seed past `allowUserToCreateOrganization: false`.
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

/** Every grant write is a SEC-15 audit row, seeded ones included (Q56). */
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

export const SEED_AUDIT_DETAIL_PREFIX = "seeded by qcms:create-admin";

/** No `responses.*` grant: reading response data stays a deliberate, audited act (Q29). */
export const SEEDED_FIRST_ADMIN_ROLES: readonly string[] = ["forms.editor", "forms.approver"];

/** Must stay value-free: the printed line carries no credential (SEC-8). */
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
