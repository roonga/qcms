import {
  OWNER_MEMBER_ROLE,
  SEED_WORKSPACE_NAME,
  SEED_WORKSPACE_SLUG,
  addAccessGroupHolder,
  countAdminUsers,
  countSiteAdministrators,
  ensureWorkspaceMember,
  findAdminsByEmail,
  listWorkspaces,
  makeSiteAdministrator,
  SITE_ADMINISTRATOR_ROLE,
  setMemberRole,
  writeAccessAuditRow,
} from "@roonga/qcms-db";
import type { AccessGroupRow, Executor } from "@roonga/qcms-db";

import { createStarterGroups, createWorkspaceWithStarterGroups } from "../workspaces/create.js";

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
  /** Accounts exist and none is a Site administrator, and the re-run cannot name which to promote. */
  | { readonly kind: "no-account-to-promote"; readonly existingAccounts: number }
  | { readonly kind: "invalid-email" }
  | { readonly kind: "weak-password"; readonly minLength: number }
  | { readonly kind: "compromised-password" }
  | { readonly kind: "breach-corpus-unreachable" }
  /** The vendor status and message are safe to surface: neither carries the credential. */
  | { readonly kind: "sign-up-rejected"; readonly status: number; readonly detail: string }
  | { readonly kind: "promotion-failed"; readonly email: string; readonly detail: string }
  | { readonly kind: "workspace-seed-failed"; readonly email: string; readonly detail: string };

export type BootstrapResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly email: string;
      readonly workspaceId: string;
      readonly workspaceSlug: string;
      /** A re-run that promoted the one existing account rather than creating it. */
      readonly promoted: boolean;
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
  const existingAdmins = await countSiteAdministrators(exec);
  if (existingAdmins > 0) {
    return { ok: false, refusal: { kind: "already-bootstrapped", existingAdmins } };
  }
  if (!looksLikeEmail(input.email)) {
    return { ok: false, refusal: { kind: "invalid-email" } };
  }
  const existingAccounts = await countAdminUsers(exec);
  if (existingAccounts > 0) return promoteOnlyAccount(exec, input.email, existingAccounts);
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
    await makeSiteAdministrator(exec, body.user.id);
  } catch (error) {
    return {
      ok: false,
      refusal: { kind: "promotion-failed", email: body.user.email, detail: messageOf(error) },
    };
  }
  try {
    // Outside the promotion, so a failed seed still leaves a Site administrator who can
    // create the workspace through the API.
    const workspace = await exec.transaction((tx) => seedFirstWorkspace(tx, body.user.id));
    return {
      ok: true,
      userId: body.user.id,
      email: body.user.email,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      promoted: false,
    };
  } catch (error) {
    return {
      ok: false,
      refusal: { kind: "workspace-seed-failed", email: body.user.email, detail: messageOf(error) },
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The recovery for a first run that created its account and died before promoting it: with
 * no Site administrator and exactly that one account, promote it, seed and audit in one
 * transaction. The address must name it, so a re-run never promotes an account by accident.
 */
async function promoteOnlyAccount(
  exec: Executor,
  email: string,
  existingAccounts: number,
): Promise<BootstrapResult> {
  const matches = existingAccounts === 1 ? await findAdminsByEmail(exec, email) : [];
  const account = matches.length === 1 ? matches[0] : undefined;
  if (account === undefined) {
    return { ok: false, refusal: { kind: "no-account-to-promote", existingAccounts } };
  }
  try {
    const workspace = await exec.transaction(async (tx) => {
      await makeSiteAdministrator(tx, account.userId);
      const seeded = await seedFirstWorkspace(tx, account.userId);
      await writeAccessAuditRow(tx, {
        actor: account.userId,
        workspaceId: seeded.id,
        kind: "grant",
        detail:
          `${SEED_AUDIT_DETAIL_PREFIX} siteRole=${SITE_ADMINISTRATOR_ROLE} ` +
          `subject=${account.userId} promoted on re-run`,
      });
      return seeded;
    });
    return {
      ok: true,
      userId: account.userId,
      email: account.email,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      promoted: true,
    };
  } catch (error) {
    return {
      ok: false,
      refusal: { kind: "promotion-failed", email: account.email, detail: messageOf(error) },
    };
  }
}

/**
 * The one-person site: the first account is Workspace administrator of the first workspace
 * and a member of all four starter groups. An existing workspace, which only a fixture
 * leaves behind, is adopted rather than duplicated.
 */
async function seedFirstWorkspace(
  tx: Executor,
  userId: string,
): Promise<{ id: string; slug: string }> {
  const first = (await listWorkspaces(tx))[0];
  let workspace: { id: string; slug: string };
  let groups: readonly AccessGroupRow[];
  if (first === undefined) {
    const created = await createWorkspaceWithStarterGroups(tx, {
      name: SEED_WORKSPACE_NAME,
      slug: SEED_WORKSPACE_SLUG,
      firstAdministratorId: userId,
      actor: userId,
      auditPrefix: SEED_AUDIT_DETAIL_PREFIX,
    });
    workspace = created.workspace;
    groups = created.groups;
  } else {
    workspace = first;
    await ensureWorkspaceMember(tx, first.id, userId);
    await setMemberRole(tx, first.id, userId, OWNER_MEMBER_ROLE);
    await writeAccessAuditRow(tx, {
      actor: userId,
      workspaceId: first.id,
      kind: "grant",
      detail: `${SEED_AUDIT_DETAIL_PREFIX} memberRole=${OWNER_MEMBER_ROLE} subject=${userId}`,
    });
    groups = await createStarterGroups(tx, first.id);
  }
  for (const group of groups) {
    await addAccessGroupHolder(tx, group.teamId, userId);
    await writeAccessAuditRow(tx, {
      actor: userId,
      workspaceId: workspace.id,
      kind: "grant",
      detail:
        `${SEED_AUDIT_DETAIL_PREFIX} subject=${userId} group=${group.name} ` +
        `roles=${group.roles.join(",")} environments=${group.environments.join(",")}`,
    });
  }
  return { id: workspace.id, slug: workspace.slug };
}

export const SEED_AUDIT_DETAIL_PREFIX = "seeded by qcms:create-admin";

/** Must stay value-free: the printed line carries no credential. */
export function describeRefusal(refusal: BootstrapRefusal): string {
  switch (refusal.kind) {
    case "already-bootstrapped":
      return `Refusing: this deployment already has ${refusal.existingAdmins} Site administrator(s). The bootstrap command only runs on a deployment with none.`;
    case "no-account-to-promote":
      return (
        `Refusing: this deployment has ${refusal.existingAccounts} account(s) and no Site ` +
        "administrator. A re-run promotes only when exactly one account exists and " +
        "QCMS_ADMIN_EMAIL names it."
      );
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
    case "promotion-failed":
      return (
        `The account for ${refusal.email} exists, but could not be made Site administrator ` +
        `(${refusal.detail}). Re-run this command with the same QCMS_ADMIN_EMAIL: it ` +
        "promotes that account and seeds the first workspace."
      );
    case "workspace-seed-failed":
      return (
        `Created the Site administrator account for ${refusal.email}, but could not seed the ` +
        `first workspace (${refusal.detail}). Re-running this command is refused; sign in ` +
        "and create the workspace with POST /admin/workspaces once the API is up."
      );
    case "sign-up-rejected":
      return (
        `Refusing: creating the account failed with HTTP ${refusal.status} (${refusal.detail}). ` +
        "This is not the SEC-1 breach check: an unreachable corpus reports itself " +
        "explicitly and names the network."
      );
  }
}
