/** Role names are API vocabulary, not client authorization decisions. Render the wire values without maintaining another policy union. */

import type { ShellCapabilities } from "../shell/modes.ts";

export interface WorkspaceListItem {
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly archivedAt: string | null;
  /** Administration, so absent where the caller holds no `workspace: read` there. */
  readonly isShared: boolean | undefined;
  readonly requireSecondApprover: boolean | undefined;
  readonly forms: number | undefined;
  readonly questions: number | undefined;
}

export interface WorkspaceMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;

  readonly role: string;
  readonly groups: readonly string[];
}

export interface AccessGroup {
  readonly teamId: string;

  readonly name: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
  readonly externalGroupId: string | null;
  readonly holders: readonly { readonly userId: string; readonly email: string }[];
}

export interface AccessGroupList {
  readonly workspaceId: string;
  readonly groups: readonly AccessGroup[];
}

export interface WorkspaceSettings {
  readonly workspaceId: string;
  readonly requireSecondApprover: boolean;
}

export interface AuditRow {
  readonly id: string;
  readonly actor: string;

  readonly actorEmail: string | null;
  readonly environment: string | null;
  readonly formId: string | null;
  readonly kind: string;
  readonly occurredAt: string;
  readonly detail: string | null;
}

export interface AuditPage {
  readonly workspaceId: string;
  readonly rows: readonly AuditRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface AgentAuditRow {
  readonly id: string;
  readonly proposalId: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly actor: string;

  readonly actorEmail: string | null;
  readonly environment: string | null;
  readonly formId: string | null;
  readonly kind: string;
  readonly screen: string;
  readonly proposedAt: string;
  readonly confirmedAt: string;
  readonly detail: string | null;
}

export interface AgentAuditPage {
  readonly workspaceId: string;
  readonly rows: readonly AgentAuditRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface HeldGrant {
  readonly name: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
}

export interface MyAccessWorkspace {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly archived: boolean;
  readonly memberRole: string | null;
  readonly grants: readonly HeldGrant[];

  readonly environments: readonly string[];
}

export interface MyAccess {
  readonly userId: string;
  readonly installationAdmin: boolean;
  /** Area projection guides navigation only; routes still enforce their own grants. */
  readonly capabilities: ShellCapabilities;
  readonly workspaces: readonly MyAccessWorkspace[];
}

export const RESPONSES_ERASER_ROLE = "responses.eraser";

/** Skip cross-environment offers for callers with no eraser grant anywhere. This is only a fetch optimization; the API narrows the actual form offer. */
export function holdsEraserGrantAnywhere(access: MyAccess): boolean {
  return access.workspaces.some((workspace) =>
    workspace.grants.some((grant) => grant.roles.includes(RESPONSES_ERASER_ROLE)),
  );
}

/** Action-card results must be filtered to each registered kind allowlist before reaching the next turn. */
export type MembershipActionState =
  | { readonly status: "idle" }
  | {
      readonly status: "done";
      readonly message: string;
      readonly teamId?: string;
      readonly name?: string;
      readonly role?: string;
      readonly userId?: string;
      readonly requireSecondApprover?: boolean;
    }
  | { readonly status: "error"; readonly message: string };
