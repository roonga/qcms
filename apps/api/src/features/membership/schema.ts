import { z } from "@hono/zod-openapi";

import { ACCESS_AUDIT_KINDS, ACCESS_GROUP_LABEL_PATTERN, TEAM_ROLES } from "@roonga/qcms-db";

/**
 * Request and response schemas for the membership routes (ADR-41, Q35, Q37, Q39, Q45,
 * Q56, Q57; task 069).
 *
 * Two absences are deliberate and worth reading twice.
 *
 * **No `externalGroupId` on any request body** (Q39, criterion 15). It is task C3's join
 * key, written only by the sync path, so there is no field here for a caller to set it
 * through and `z.strictObject` refuses the key rather than stripping it (#893).
 *
 * **No role on an access-group update.** A different role is a different grant, and an
 * update that moved one would change what a group grants under the people holding it.
 * The operator deletes the group and creates the one they meant, which is two audited
 * acts rather than one unaudited change of meaning.
 */

/** The workspace on every `/workspaces/{id}/...` route in this slice. */
export const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "org_default_workspace" }),
});

/** The workspace and the access group. */
export const AccessGroupParams = WorkspaceIdParam.extend({
  teamId: z.string().openapi({ param: { name: "teamId", in: "path" }, example: "tm_0a1b2c" }),
});

/** The workspace, the access group and the holder. */
export const AccessGroupHolderParams = AccessGroupParams.extend({
  userId: z.string().openapi({ param: { name: "userId", in: "path" }, example: "usr_0a1b2c" }),
});

/** The workspace and the member. */
export const WorkspaceMemberParams = WorkspaceIdParam.extend({
  userId: z.string().openapi({ param: { name: "userId", in: "path" }, example: "usr_0a1b2c" }),
});

/** One of the five roles an access group may carry. `forms.owner` is the member row's. */
const TeamRole = z
  .enum(TEAM_ROLES as unknown as [string, ...string[]])
  .openapi({ example: "responses.viewer" });

/**
 * An environment scope: `["all"]`, or one or more environment names.
 *
 * The **names** are checked against `control.environments` by the handler, not here: the
 * live set is a table and a schema cannot read one. What this refuses is a shape - an
 * empty scope, or a value that is not a name at all.
 */
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

/**
 * A form scope: `["all"]`, or one or more form ids (Q28).
 *
 * `all` is spelled as the single-element set rather than as a separate flag, so the two
 * dimensions read the same way and a caller who has learned one has learned the other.
 */
const FormScope = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(256)
  .openapi({ example: ["all"] });

/** The optional free-text label a form-limited group carries (Q37). */
const GroupLabel = z
  .string()
  .min(1)
  .max(48)
  .regex(ACCESS_GROUP_LABEL_PATTERN)
  .openapi({ example: "claims" });

/**
 * `POST /admin/workspaces/{id}/access-groups` - one grant's role, its scope and its name.
 *
 * The **name is sent by the caller and checked against the fields** rather than being
 * derived silently (Q37 rule 1): the fields are authoritative and the name is a label, so
 * a name out of step with them is a validation error on save and the admin screen is what
 * keeps the two together as somebody types. A write path that derived the name instead
 * would make criterion 13 untestable from the outside - there would be no name for a
 * caller to get wrong.
 */
export const CreateAccessGroupBody = z
  .strictObject({
    name: z.string().min(3).max(120).openapi({ example: "test.responses.viewer" }),
    role: TeamRole,
    environments: EnvironmentScope,
    forms: FormScope,
    label: GroupLabel.optional(),
  })
  .openapi("CreateAccessGroupBody");

/** `PUT /admin/workspaces/{id}/access-groups/{teamId}` - the name and the scope, never the role. */
export const UpdateAccessGroupBody = z
  .strictObject({
    name: z.string().min(3).max(120).openapi({ example: "test-dev.responses.viewer" }),
    environments: EnvironmentScope,
    forms: FormScope,
    label: GroupLabel.optional(),
  })
  .openapi("UpdateAccessGroupBody");

/**
 * `POST /admin/workspaces/{id}/access-groups/{teamId}/holders` - who holds the grant.
 *
 * By **account id**, with the address as the alternative, because an owner reading a
 * membership list has the address and a script has the id. Exactly one of the two, for
 * Q19's reason one design over: a body that carried both and disagreed would have to pick,
 * and picking is the failure.
 */
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

/**
 * `PUT /admin/workspaces/{id}/members/{userId}` - the member row's role.
 *
 * Two values and no third: `forms.owner`, which is a grant, and the empty `member` name,
 * which is not and which exists to make a team grant expressible (finding G).
 */
export const SetMemberRoleBody = z
  .strictObject({
    role: z.enum(["forms.owner", "member"]).openapi({ example: "forms.owner" }),
  })
  .openapi("SetMemberRoleBody");

/**
 * `PUT /admin/workspaces/{id}/settings` - the two per-workspace switches.
 *
 * `requireSecondApprover` is Q13's: off by default, read by task 070 for the two-person
 * rule at a `prod` release and a `prod` endpoint change, and read **here** for Q56's
 * self-grant rule, so an installation turns on one thing and gets the whole two-person
 * posture. This task is the first write path it has.
 *
 * `seedNewEditorsWithTestData` is Q39's and Q57's: off by default, and turning it on
 * writes a SEC-15 row of kind `setting`, because **a grant on `test` responses is a grant
 * on personal data** - a test run can involve real respondents.
 *
 * Both optional, so a caller changes one without restating the other, and a body naming
 * neither is refused rather than treated as a no-op write that would still write an audit
 * row.
 */
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

/** One access group as the API reports it, with its derived names (Q37). */
const AccessGroupView = z.object({
  teamId: z.string(),
  /** The stored name, shown inside a workspace page. */
  name: z.string(),
  /** `<workspace>.<team>`, derived and never stored, for cross-workspace lists. */
  fullName: z.string(),
  /** `qcms.<workspace>.<team>`, the task C3 directory name. Derived and never stored. */
  directoryName: z.string(),
  role: z.string(),
  environments: z.array(z.string()),
  forms: z.array(z.string()),
  /** Whether task C3's sync path has mapped a directory group to this group yet. */
  externalGroupId: z.string().nullable(),
  holders: z.array(z.object({ userId: z.string(), email: z.string() })),
});

export const AccessGroupListResponse = z
  .object({
    workspaceId: z.string(),
    groups: z.array(AccessGroupView),
    /**
     * The sentence the UI prints beside the scope chooser (Q37), served by the API so
     * the statement about the matrix lives where the matrix is enforced.
     */
    scopeNote: z.string(),
  })
  .openapi("AccessGroupListResponse");

export const AccessGroupResponse = z
  .object({ group: AccessGroupView })
  .openapi("AccessGroupResponse");

/** The membership list: the member rows and their roles (Q35). */
export const WorkspaceMemberListResponse = z
  .object({
    workspaceId: z.string(),
    members: z.array(
      z.object({
        userId: z.string(),
        email: z.string(),
        name: z.string(),
        role: z.string(),
        /** The access groups this person holds in this workspace, by stored name. */
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

/**
 * `GET /admin/me/access` - which workspaces, roles, environments and forms the caller
 * holds (Q35).
 *
 * It is how everybody who is not an owner or the installation administrator learns their
 * own grants, since the membership list itself is theirs alone to see. It answers the
 * caller's own grants **and nobody else's**, which is why it takes no parameter naming a
 * person: there is no shape of this request that asks about somebody else.
 */
export const MyAccessResponse = z
  .object({
    userId: z.string(),
    /** Whether the caller holds the installation-wide administrator claim. */
    installationAdmin: z.boolean(),
    workspaces: z.array(
      z.object({
        workspaceId: z.string(),
        slug: z.string(),
        name: z.string(),
        archived: z.boolean(),
        /** The `member` row's role: `forms.owner`, or the empty role, or absent. */
        memberRole: z.string().nullable(),
        grants: z.array(
          z.object({
            name: z.string(),
            role: z.string(),
            environments: z.array(z.string()),
            forms: z.array(z.string()),
          }),
        ),
        /** The environments the caller holds in some grant, which the Q6 switcher offers. */
        environments: z.array(z.string()),
      }),
    ),
  })
  .openapi("MyAccessResponse");

/** `GET /admin/workspaces/{id}/audit` - the SEC-15 rows, newest first. */
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
        /** The actor's address where the account still exists; the audit row has no key to it. */
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
