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

/** The account's own state, as the members list reports it. */
export type MemberStatus = "active" | "unclaimed" | "disabled";

export interface WorkspaceMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;

  readonly role: string;
  readonly status: MemberStatus;
  readonly groups: readonly string[];
}

export interface AccessGroupHolder {
  readonly userId: string;
  readonly email: string;
  /** Held until another administrator re-confirms it, so it grants nothing yet. */
  readonly suspended: boolean;
}

export interface AccessGroup {
  readonly teamId: string;

  readonly name: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
  readonly externalGroupId: string | null;
  readonly holders: readonly AccessGroupHolder[];
}

export interface AccessGroupList {
  readonly workspaceId: string;
  readonly groups: readonly AccessGroup[];
}

export interface SecondApprovalShortfall {
  readonly administrator: boolean;
  readonly publisher: boolean;
}

export interface WorkspaceSettings {
  readonly workspaceId: string;
  readonly requireSecondApprover: boolean;
  /** Read from the caller's seat: the warning while the rule is on, the refusal to turn it on while it is off. */
  readonly nobodyElseCouldApprove: boolean;
  readonly missingApprover: SecondApprovalShortfall;
}

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "lapsed"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** A workspace act held for an Approver. `lapsed` ends one whose subject moved before it was applied. */
export interface ApprovalRequest {
  readonly requestId: string;
  readonly kind: string;
  readonly target: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly status: ApprovalStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
}

export interface ApprovalRequestPage {
  readonly workspaceId: string;
  readonly requests: readonly ApprovalRequest[];
  readonly page: number;
  readonly total: number;
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

/** One account the audit names, for the Person filter. */
export interface AuditActor {
  readonly actor: string;
  readonly actorEmail: string | null;
}

export interface AuditPage {
  readonly workspaceId: string;
  readonly rows: readonly AuditRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** The accounts the whole audit names, capped by the API, whatever the filters narrow. */
  readonly actors: readonly AuditActor[];
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
  /** Who to ask for access; the API sends it only to an account that holds nothing. */
  readonly siteAdministrators: readonly { readonly name: string; readonly email: string }[];
  /** Two or more workspaces not archived on the installation; sent to an administrator only. */
  readonly multipleWorkspaces: boolean;
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
      /** The request a decision was made on. */
      readonly request?: ApprovalRequest;
    }
  | { readonly status: "error"; readonly message: string }
  /** The API took the act as a request, or refused it until an Approver makes it: never a success. */
  | { readonly status: "held"; readonly message: string };
