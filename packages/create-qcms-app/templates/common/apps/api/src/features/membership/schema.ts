import { z } from "@hono/zod-openapi";

import {
  ACCESS_AUDIT_KINDS,
  ACCESS_GROUPS_MAX_ROLES,
  ACCESS_ROLES,
  SITE_AUDIT_KINDS,
} from "@roonga/qcms-db";

import { ApprovalRequestView } from "../site-admins/schema.js";

// No `externalGroupId` on a request body: it is the directory sync join key, and
// `z.strictObject` refuses it.

export const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "org_default_workspace" }),
});

export const AccessGroupParams = WorkspaceIdParam.extend({
  teamId: z.string().openapi({ param: { name: "teamId", in: "path" }, example: "tm_0a1b2c" }),
});

export const AccessGroupHolderParams = AccessGroupParams.extend({
  userId: z.string().openapi({ param: { name: "userId", in: "path" }, example: "usr_0a1b2c" }),
});

export const WorkspaceMemberParams = WorkspaceIdParam.extend({
  userId: z.string().openapi({ param: { name: "userId", in: "path" }, example: "usr_0a1b2c" }),
});

const AccessGroupRoles = z
  .array(z.enum(ACCESS_ROLES as unknown as [string, ...string[]]))
  .min(1)
  .max(ACCESS_GROUPS_MAX_ROLES)
  .openapi({ example: ["responses.viewer"] });

// Shape only, and empty where every role in the group ignores it. The names are checked
// against the live `control.environments` set by the handler, since a schema cannot read
// a table.
const EnvironmentSet = z
  .array(
    z
      .string()
      .regex(/^[a-z][a-z0-9]*$/)
      .max(53),
  )
  .max(32)
  .openapi({ example: ["test"] });

const AccessGroupName = z.string().min(1).max(120).openapi({ example: "Response viewers" });

export const CreateAccessGroupBody = z
  .strictObject({
    name: AccessGroupName,
    roles: AccessGroupRoles,
    environments: EnvironmentSet,
  })
  .openapi("CreateAccessGroupBody");

export const UpdateAccessGroupBody = z
  .strictObject({
    name: AccessGroupName,
    roles: AccessGroupRoles,
    environments: EnvironmentSet,
  })
  .openapi("UpdateAccessGroupBody");

// Exactly one of id or address: a body carrying both and disagreeing would have to pick,
// and picking is the failure.
export const AddHolderBody = z
  .strictObject({
    userId: z.string().min(1).max(64).optional().openapi({ example: "usr_0a1b2c" }),
    email: z.email().max(320).optional().openapi({ example: "officer@qcms.test" }),
  })
  .refine(
    (body) => (body.userId === undefined) !== (body.email === undefined),
    "Provide exactly one of userId or email",
  )
  .openapi("AddHolderBody");

// Two values and no third: the Workspace administrator flag, and the empty `member`
// name, which grants nothing and exists only to make a group grant expressible.
export const SetMemberRoleBody = z
  .strictObject({
    role: z.enum(["forms.owner", "member"]).openapi({ example: "forms.owner" }),
  })
  .openapi("SetMemberRoleBody");

export const WorkspaceSettingsBody = z
  .strictObject({ requireSecondApprover: z.boolean() })
  .openapi("WorkspaceSettingsBody");

const AccessGroupView = z.object({
  teamId: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
  environments: z.array(z.string()),
  externalGroupId: z.string().nullable(),
  // `suspended`: held until another administrator re-confirms it, so it grants nothing yet.
  holders: z.array(z.object({ userId: z.string(), email: z.string(), suspended: z.boolean() })),
});

export const AccessGroupListResponse = z
  .object({ workspaceId: z.string(), groups: z.array(AccessGroupView) })
  .openapi("AccessGroupListResponse");

export const AccessGroupResponse = z
  .object({ group: AccessGroupView })
  .openapi("AccessGroupResponse");

export const WorkspaceMemberListResponse = z
  .object({
    workspaceId: z.string(),
    members: z.array(
      z.object({
        userId: z.string(),
        email: z.string(),
        name: z.string(),
        role: z.string(),
        status: z.enum(["active", "unclaimed", "disabled"]),
        groups: z.array(z.string()),
      }),
    ),
  })
  .openapi("WorkspaceMemberListResponse");

export const WorkspaceMemberResponse = z
  .object({ userId: z.string(), role: z.string() })
  .openapi("WorkspaceMemberResponse");

export const WorkspaceSettingsResponse = z
  .object({ workspaceId: z.string(), requireSecondApprover: z.boolean() })
  .openapi("WorkspaceSettingsResponse");

export const WorkspaceSettingsHeldResponse = z
  .object({
    workspaceId: z.string(),
    requireSecondApprover: z.boolean(),
    request: ApprovalRequestView,
  })
  .openapi("WorkspaceSettingsHeldResponse");

export const WorkspaceSettingsReadResponse = z
  .object({
    workspaceId: z.string(),
    requireSecondApprover: z.boolean(),
    // Read from the caller's seat, whether the switch is on or off: the warning while it is
    // on, and the turn-on refusal while it is off.
    nobodyElseCouldApprove: z.boolean(),
    missingApprover: z.object({ administrator: z.boolean(), publisher: z.boolean() }),
  })
  .openapi("WorkspaceSettingsReadResponse");

export const AccessGroupHeldResponse = z
  .object({ group: AccessGroupView, request: ApprovalRequestView })
  .openapi("AccessGroupHeldResponse");

// The caller's own grants and nobody else's, which is why the route takes no parameter
// naming a person.
export const MyAccessResponse = z
  .object({
    userId: z.string(),
    installationAdmin: z.boolean(),
    // Which areas of the admin this caller has at all, each derived from the cell that
    // area's routes require, so a navigation contract cannot offer a mode whose routes
    // refuse. A projection, not an authority: every route still decides.
    capabilities: z.object({
      // Any one of the operational cells anywhere. False for a `forms.owner` alone and
      // for the installation claim alone, neither of which reaches a form cell.
      operations: z.boolean(),
      // `workspace: read`, which is a Workspace administrator's and the claim's.
      workspaces: z.boolean(),
      // The installation claim alone.
      siteConfiguration: z.boolean(),
      // `form: read` or `question: read` in some workspace.
      authoring: z.boolean(),
    }),
    // Who to ask for access: the active, claimed Site administrators, sent only to a
    // caller who holds nothing, and empty for everyone else.
    siteAdministrators: z.array(z.object({ name: z.string(), email: z.string() })),
    workspaces: z.array(
      z.object({
        workspaceId: z.string(),
        slug: z.string(),
        name: z.string(),
        archived: z.boolean(),
        memberRole: z.string().nullable(),
        grants: z.array(
          z.object({
            name: z.string(),
            roles: z.array(z.string()),
            environments: z.array(z.string()),
          }),
        ),
        // Places in groups suspended until an administrator re-confirms them. They grant
        // nothing, and are not counted in `environments`.
        suspended: z.array(
          z.object({
            name: z.string(),
            roles: z.array(z.string()),
            environments: z.array(z.string()),
          }),
        ),
        // The environments the caller's groups name, plus every environment where a
        // group of theirs ignores the set: this is what the environment switcher offers.
        environments: z.array(z.string()),
      }),
    ),
    // The installation holds two or more workspaces not archived. False to a caller who
    // administers none and holds no installation claim, who has no use for it.
    multipleWorkspaces: z.boolean(),
  })
  .openapi("MyAccessResponse");

export const AuditQuery = z.object({
  kind: z
    .enum(ACCESS_AUDIT_KINDS)
    .optional()
    .openapi({ param: { name: "kind", in: "query" } }),
  actor: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({ param: { name: "actor", in: "query" } }),
  page: z
    .string()
    .optional()
    .openapi({ param: { name: "page", in: "query" } }),
  pageSize: z
    .string()
    .optional()
    .openapi({ param: { name: "pageSize", in: "query" } }),
});

export const AuditListResponse = z
  .object({
    workspaceId: z.string(),
    rows: z.array(
      z.object({
        id: z.string(),
        actor: z.string(),
        // Null once the account is gone: the audit row holds no key to it, so the row
        // survives the account.
        actorEmail: z.string().nullable(),
        environment: z.string().nullable(),
        formId: z.string().nullable(),
        kind: z.string(),
        occurredAt: z.string(),
        detail: z.string().nullable(),
      }),
    ),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    // The accounts the whole audit names, capped, whatever `kind` and `actor` narrow the rows to.
    actors: z.array(z.object({ actor: z.string(), actorEmail: z.string().nullable() })),
  })
  .openapi("AuditListResponse");

export const SiteAuditQuery = z.object({
  kind: z
    .enum(SITE_AUDIT_KINDS)
    .optional()
    .openapi({ param: { name: "kind", in: "query" } }),
  page: z
    .string()
    .optional()
    .openapi({ param: { name: "page", in: "query" } }),
  pageSize: z
    .string()
    .optional()
    .openapi({ param: { name: "pageSize", in: "query" } }),
});

export const SiteAuditListResponse = z
  .object({
    rows: z.array(
      z.object({
        id: z.string(),
        actor: z.string(),
        // Null once the account is gone, as the access audit's is.
        actorEmail: z.string().nullable(),
        // The account, workspace or request the act was on.
        subject: z.string().nullable(),
        // Set where the act affects one workspace, which also holds a mirrored row.
        workspaceId: z.string().nullable(),
        kind: z.string(),
        occurredAt: z.string(),
        detail: z.string().nullable(),
      }),
    ),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi("SiteAuditListResponse");

export const AgentAuditQuery = z.object({
  kind: z
    .string()
    .max(100)
    .optional()
    .openapi({ param: { name: "kind", in: "query" } }),
  page: z
    .string()
    .optional()
    .openapi({ param: { name: "page", in: "query" } }),
  pageSize: z
    .string()
    .optional()
    .openapi({ param: { name: "pageSize", in: "query" } }),
});

export const AgentAuditListResponse = z
  .object({
    workspaceId: z.string(),
    rows: z.array(
      z.object({
        id: z.string(),
        proposalId: z.string(),
        stepIndex: z.number().int(),
        stepCount: z.number().int(),
        actor: z.string(),
        // Null once the account is gone, as the access audit's is.
        actorEmail: z.string().nullable(),
        environment: z.string().nullable(),
        formId: z.string().nullable(),
        kind: z.string(),
        screen: z.string(),
        proposedAt: z.string(),
        confirmedAt: z.string(),
        // A version, an environment name, a count or a role name; never content.
        detail: z.string().nullable(),
      }),
    ),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi("AgentAuditListResponse");
