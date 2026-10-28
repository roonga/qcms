import { z } from "@hono/zod-openapi";

import { ACCESS_AUDIT_KINDS, ACCESS_GROUP_LABEL_PATTERN, TEAM_ROLES } from "@roonga/qcms-db";

// No `externalGroupId` on a request body (the directory sync join key; `z.strictObject`
// refuses it) and no role on an access-group update (it would change what holders get).

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

const TeamRole = z
  .enum(TEAM_ROLES as unknown as [string, ...string[]])
  .openapi({ example: "responses.viewer" });

// Shape only. The names are checked against the live `control.environments` set by the
// handler, since a schema cannot read a table.
const EnvironmentScope = z
  .array(
    z
      .string()
      .regex(/^[a-z][a-z0-9]*$/)
      .max(53),
  )
  .min(1)
  .max(32)
  .openapi({ example: ["test"] });

const FormScope = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(256)
  .openapi({ example: ["all"] });

const GroupLabel = z
  .string()
  .min(1)
  .max(48)
  .regex(ACCESS_GROUP_LABEL_PATTERN)
  .openapi({ example: "claims" });

// The role and scope fields are authoritative and the name is only a label: it is sent by
// the caller and refused when out of step, never derived silently.
export const CreateAccessGroupBody = z
  .strictObject({
    name: z.string().min(3).max(120).openapi({ example: "test.responses.viewer" }),
    role: TeamRole,
    environments: EnvironmentScope,
    forms: FormScope,
    label: GroupLabel.optional(),
  })
  .openapi("CreateAccessGroupBody");

export const UpdateAccessGroupBody = z
  .strictObject({
    name: z.string().min(3).max(120).openapi({ example: "test-dev.responses.viewer" }),
    environments: EnvironmentScope,
    forms: FormScope,
    label: GroupLabel.optional(),
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

// Two values and no third: `forms.owner`, and the empty `member` name, which grants
// nothing and exists only to make a team grant expressible.
export const SetMemberRoleBody = z
  .strictObject({
    role: z.enum(["forms.owner", "member"]).openapi({ example: "forms.owner" }),
  })
  .openapi("SetMemberRoleBody");

// Both switches default off and both are optional, so a caller changes one without
// restating the other. A body naming neither is refused rather than writing an audit row
// for a no-op.
export const WorkspaceSettingsBody = z
  .strictObject({
    requireSecondApprover: z.boolean().optional(),
    seedNewEditorsWithTestData: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.requireSecondApprover !== undefined || body.seedNewEditorsWithTestData !== undefined,
    "Name at least one setting to change",
  )
  .openapi("WorkspaceSettingsBody");

const AccessGroupView = z.object({
  teamId: z.string(),
  name: z.string(),
  // `fullName` and `directoryName` are derived on read and never stored, so renaming a
  // workspace slug changes display only.
  fullName: z.string(),
  directoryName: z.string(),
  role: z.string(),
  environments: z.array(z.string()),
  forms: z.array(z.string()),
  externalGroupId: z.string().nullable(),
  holders: z.array(z.object({ userId: z.string(), email: z.string() })),
});

export const AccessGroupListResponse = z
  .object({
    workspaceId: z.string(),
    groups: z.array(AccessGroupView),
    // Served by the API so the statement about the matrix lives where it is enforced.
    scopeNote: z.string(),
  })
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
        groups: z.array(z.string()),
      }),
    ),
  })
  .openapi("WorkspaceMemberListResponse");

export const WorkspaceMemberResponse = z
  .object({ userId: z.string(), role: z.string() })
  .openapi("WorkspaceMemberResponse");

export const WorkspaceSettingsResponse = z
  .object({
    workspaceId: z.string(),
    requireSecondApprover: z.boolean(),
    seedNewEditorsWithTestData: z.boolean(),
  })
  .openapi("WorkspaceSettingsResponse");

// The caller's own grants and nobody else's, which is why the route takes no parameter
// naming a person.
export const MyAccessResponse = z
  .object({
    userId: z.string(),
    installationAdmin: z.boolean(),
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
            role: z.string(),
            environments: z.array(z.string()),
            forms: z.array(z.string()),
          }),
        ),
        // Only the environments the caller holds in some grant: this is what the
        // environment switcher offers.
        environments: z.array(z.string()),
      }),
    ),
  })
  .openapi("MyAccessResponse");

export const AuditQuery = z.object({
  kind: z
    .enum(ACCESS_AUDIT_KINDS as unknown as [string, ...string[]])
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
  })
  .openapi("AuditListResponse");
