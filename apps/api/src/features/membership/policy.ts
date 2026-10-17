/**
 * The authorisation policy: six roles as disjoint statements, and the two scope
 * dimensions that narrow them (ADR-41, Q25, Q27, Q28, Q32, Q38; SEC-3; task 069).
 *
 * **The permissions matrix in section 6 of `plan/environments-and-workspaces.md` is this
 * module's specification**, not a summary of it. Every statement below is a cell of that
 * table, and the cells it does *not* have are as load-bearing as the ones it does: the
 * `forms.owner` column touches no form, release, link, webhook or response row at all,
 * `forms.viewer` has only the two read rows, and the installation claim's last row is a
 * **`never`** rather than an empty cell.
 *
 * # Two families that imply nothing about each other
 *
 * The surprising half, and the part to build against (Q27): a single role ladder
 * **cannot** express "authors may not see production data", because every rung above
 * `viewer` contains it. So there are two families - `forms.` on the control plane and
 * `responses.` on an environment's data plane - and **no role implies a right in the
 * other**. `forms.owner` implies nothing at all in the data family: an owner administers
 * a workspace and reads no response without a `responses.viewer` grant of their own.
 *
 * Since Q38 each role carries its plane in its name, so the separation is visible rather
 * than footnoted, and `viewer` is safe in both families because the prefix distinguishes
 * them.
 *
 * # The environment and form conditions are never in a statement
 *
 * They live in the **grant's scope** (Q25, Q28), which is the whole of how Q32's
 * mechanism closes the plugin's one gap: the plugin has no notion of a scoped role, so a
 * statement says what an action is and the team row says where it reaches.
 * {@link decideAccess} is the two steps in order - evaluate the statements with the
 * plugin's own authorize function, then narrow by the scope against the act's environment
 * and form.
 *
 * # What is deliberately not here
 *
 * **`dynamicAccessControl`**, and any role a deployment defines at run time (ADR-41):
 * owner-defined roles could recreate the mixed-family role this design removed, and they
 * cannot be enumerated in the section 3.2 matrix.
 *
 * **The two-person rule.** This module defines what `forms.approver` is and what
 * `requireSecondApprover` means; task 070 builds the check at a `prod` release and at a
 * `prod` endpoint change. The one production rule that *is* here is the matrix's own
 * split: a production write belongs to a `forms.approver` and not to a `forms.editor`,
 * which is a property of the matrix rather than of the two-person switch.
 */

import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * The resources statements are written over (ADR-41, the permissions matrix).
 *
 * Nine, and the list is closed: a tenth would be a row the section 3.2 matrix does not
 * have, which is what `matrix-coverage.e2e.ts` fails on.
 */
export const RESOURCES = [
  "question",
  "form",
  "release",
  "link",
  "webhook",
  "response",
  "membership",
  "workspace",
  "audit",
] as const;

/** One of the nine resources. */
export type Resource = (typeof RESOURCES)[number];

/**
 * Every action, per resource. The vocabulary the route table maps a request onto.
 *
 * Named for the act rather than for the HTTP verb, because the same verb means different
 * things on different rows of the matrix: `POST /forms/{id}/publish` and
 * `POST /forms/{id}/releases` are both posts and are two different cells, one of which a
 * `forms.approver` holds and the other of which it does not.
 */
export const ACTIONS = {
  question: ["read", "write"],
  form: ["read", "write", "publish", "preview", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
  // `dispose` is the flag release (unflag): a disposition on a response rather than a
  // read of one, so it is the eraser's row and not the viewer's. `history` is the
  // tombstone list, which carries existence without content (ADR-17) and which **no
  // role holds**: it is installation-wide operator state, the claim's, and Q29 is intact
  // because a tombstone is not a response.
  response: ["read", "export", "erase", "dispose", "history"],
  membership: ["read", "write"],
  workspace: ["read", "update", "archive"],
  audit: ["read"],
} as const satisfies Record<Resource, readonly string[]>;

/** An action on one resource. */
export type Action = (typeof ACTIONS)[Resource][number];

/**
 * The access control the six roles are declared against.
 *
 * `defaultStatements` is spread in **on purpose**, so the plugin's own resources
 * (`organization`, `member`, `invitation`, `team`, `ac`) are part of the vocabulary and
 * every QCMS role's silence about them is explicit rather than a type error waiting to
 * happen. No QCMS role declares any of them, which is Q45's HTTP half expressed as a
 * statement: a plugin endpoint that checks `member: ["create"]` finds no role that holds
 * it, a `forms.owner` included.
 */
export const accessControl = createAccessControl({
  ...defaultStatements,
  ...ACTIONS,
});

/**
 * `forms.viewer`: the sixth role Q38 added, and the whole of it is the matrix's two read
 * rows at the top.
 *
 * It sees drafts, published versions, release history and each environment's link and
 * endpoint configuration, **in every environment** - authoring roles are workspace-wide
 * and only the write actions are environment-scoped - and it changes nothing, reads no
 * response and does not see the membership list (Q35).
 *
 * **What it sees of an endpoint's URL is Q58's and task 067 owns it**: that ruling masks
 * the query string for this role and shows it whole to a `forms.editor`, with the API
 * doing the masking in the response. Between this task and 067 this role sees the query
 * string too, and **the Code Owner has accepted that window** (Q62, 2026-09-30): masking
 * here would mean writing a rule for routes 067 has not built, and withholding the read
 * until then would change what this role means twice. Nothing here changes for it.
 */
const formsViewer = accessControl.newRole({
  question: ["read"],
  form: ["read"],
  release: ["read"],
  link: ["read"],
  webhook: ["read"],
});

/**
 * `forms.editor`: draft, edit, publish, preview, and the environment-scoped writes in
 * `dev` and `test`.
 *
 * `form: ["publish"]` releases it nowhere (ADR-40), which is why publishing is
 * environment-agnostic and needs no scope. `form: ["preview"]` is Q36's draft preview:
 * editor-only and environment-agnostic, because it writes nothing and reads no response,
 * so there is no environment to scope it to.
 *
 * It reaches **no** response in any environment, whatever its environment scope says -
 * that is criterion 2 and the reason this task has this shape.
 */
const formsEditor = accessControl.newRole({
  question: ["read", "write"],
  form: ["read", "write", "publish", "preview", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
});

/**
 * `forms.approver`: the same environment-scoped writes as an editor, and the only role
 * that holds them in `prod`.
 *
 * It does **not** draft, edit, publish or preview: those are the editor's rows, and a
 * role that both authored and approved would be the mixed-family rank Q27 removed. One
 * person may hold `forms.editor` and `forms.approver` together, so the two-person rule is
 * about two accounts rather than two kinds of person.
 */
const formsApprover = accessControl.newRole({
  question: ["read"],
  form: ["read", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
});

/**
 * `forms.owner`: the member row's role, and the one grant that is not a team (Q32).
 *
 * Membership, grants, workspace settings and the access audit. **It touches no form,
 * release, link, webhook or response row at all** - an owner administers a workspace and
 * does nothing inside it, which is Q27's two families and Q34's correction expressed as a
 * shape rather than as a sentence. An owner who should author is given a `forms.editor`
 * grant; one who should approve is given a `forms.approver` grant (Q34), which makes
 * their authority a row somebody can read rather than a rank.
 */
const formsOwner = accessControl.newRole({
  membership: ["read", "write"],
  workspace: ["read", "update", "archive"],
  audit: ["read"],
});

/** `responses.viewer`: view and export responses, in the environments and forms on the grant. */
const responsesViewer = accessControl.newRole({
  response: ["read", "export"],
});

/** `responses.eraser`: erase a response, and read or export none. */
const responsesEraser = accessControl.newRole({
  response: ["erase", "dispose"],
});

/**
 * An empty role: every resource present and no action on any of them.
 *
 * The plugin's `authorize` answers `success: false` for a resource it does not know *and*
 * for one whose action list is empty, so an empty object would do. Every resource is
 * named with an empty list instead, because that is the difference between "this role
 * grants nothing" and "this role was declared against the wrong vocabulary", and a reader
 * of the configuration can see which one they are looking at.
 */
const emptyStatements = Object.fromEntries(
  Object.keys({ ...defaultStatements, ...ACTIONS }).map((resource) => [resource, []]),
) as Record<string, never[]>;

/**
 * The roles, by the names ADR-41 uses, plus the plugin's own three overridden with empty
 * statements.
 *
 * `admin` and `member` are the two the record names (Q32): `member` is the row every
 * grant holder carries (finding G), which must grant nothing on its own, and `admin` is a
 * plugin default nothing writes. **`owner` is overridden too**, which the record does not
 * name and which is a strict narrowing rather than a new decision: `creatorRole` is
 * `forms.owner`, so nothing in QCMS ever writes the plugin's own `owner`, and leaving it
 * as the library ships it would mean a row carrying that name held the library's full
 * organisation statements. Overriding it costs nothing and closes that.
 */
export const roles = {
  "forms.viewer": formsViewer,
  "forms.editor": formsEditor,
  "forms.approver": formsApprover,
  "forms.owner": formsOwner,
  "responses.viewer": responsesViewer,
  "responses.eraser": responsesEraser,
  admin: accessControl.newRole(emptyStatements),
  member: accessControl.newRole(emptyStatements),
  owner: accessControl.newRole(emptyStatements),
} as const;

/**
 * One declared role, narrowed to the one thing the resolver calls on it.
 *
 * `authorize` is the plugin's own function and the whole of what a decision needs; the
 * nine roles' `statements` have nine different shapes, so a union of the declarations
 * themselves would make the lookup below unassignable for no benefit.
 */
interface DeclaredRole {
  authorize(request: Record<string, readonly string[]>): { readonly success: boolean };
}

/** The six role names, in the order ADR-41 lists them. */
export const ROLE_NAMES = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "forms.owner",
  "responses.viewer",
  "responses.eraser",
] as const;

/** One of the six. */
export type RoleName = (typeof ROLE_NAMES)[number];

/** The plugin role names overridden with empty statements. */
export const EMPTY_ROLE_NAMES = ["admin", "member", "owner"] as const;

/**
 * The production environment, which is the one environment name this design treats
 * specially.
 *
 * ADR-40 makes it the unprefixed address shape; Q30 and Q33 make every write in it a
 * `forms.approver`'s. `@roonga/qcms-db` carries the same word as `UNDROPPABLE_ENVIRONMENT`
 * for a third rule - a drop may never remove it - and that module says the rules are
 * different rules that land on the same word, so this is a name of its own rather than an
 * import of that one.
 */
export const PRODUCTION_ENVIRONMENT = "prod";

/**
 * The (resource, action) pairs an environment scope narrows.
 *
 * Read off Q25: "the API enforces both dimensions on every route touching **data-plane or
 * environment-scoped state**". Authoring and publishing are **not** on this list, because
 * publishing a version releases it nowhere, and neither is the draft preview (Q36).
 * Neither are the configuration **reads**: a `forms.viewer` reads release history and
 * every environment's link and endpoint configuration, production included, because
 * authoring roles are workspace-wide and only the write actions are environment-scoped.
 */
const ENVIRONMENT_SCOPED: readonly `${Resource}:${string}`[] = [
  "form:close",
  "release:create",
  "link:mint",
  "link:revoke",
  "webhook:configure",
  "response:read",
  "response:export",
  "response:erase",
  "response:dispose",
];

/**
 * The pairs a **form** scope narrows (Q28).
 *
 * The data family only: a case officer can be limited to the forms they action, while
 * authoring roles stay workspace-wide, because a draft is not sensitive in the way an
 * answer is and per-form authoring would multiply rows for no protection.
 */
const FORM_SCOPED: readonly `${Resource}:${string}`[] = [
  "response:read",
  "response:export",
  "response:erase",
  "response:dispose",
];

/** The resources on the control plane, which is the family the production split governs. */
const FORMS_FAMILY_RESOURCES: readonly Resource[] = [
  "question",
  "form",
  "release",
  "link",
  "webhook",
];

/** Whether an act's environment has to be in the grant's environment scope. */
export function isEnvironmentScoped(resource: Resource, action: string): boolean {
  return ENVIRONMENT_SCOPED.includes(`${resource}:${action}`);
}

/** Whether an act's form has to be in the grant's form scope. */
export function isFormScoped(resource: Resource, action: string): boolean {
  return FORM_SCOPED.includes(`${resource}:${action}`);
}

/** One grant held: a team row's role and scope, or the member row's role with `all`. */
export interface HeldGrant {
  readonly role: string;
  /** `["all"]`, or one or more environment names. */
  readonly environments: readonly string[];
  /** `["all"]`, or one or more form ids. */
  readonly forms: readonly string[];
  /** The stored access-group name, for a legible decision. Absent on the member row. */
  readonly name?: string;
}

/** What is being attempted. */
export interface AccessRequest {
  readonly resource: Resource;
  readonly action: string;
  /** The environment the act targets, where the act names one. */
  readonly environment?: string | undefined;
  /** The form the act targets, where the act names one. */
  readonly formId?: string | undefined;
}

/** Whether the act is allowed, and which grant allowed or refused it. */
export interface AccessDecision {
  readonly allowed: boolean;
  /** The role that allowed it. Set only when `allowed`. */
  readonly role?: string;
  /** The access group that allowed it, where a team carried the grant. */
  readonly name?: string;
  /** Why not, for a refusal a reader can act on. Never names another person's grant. */
  readonly reason?: string;
}

/** The scope token meaning "every environment" or "every form". */
const SCOPE_ALL = "all";

function scopeAllows(scope: readonly string[], value: string | undefined): boolean {
  if (scope.length === 1 && scope[0] === SCOPE_ALL) return true;
  return value !== undefined && scope.includes(value);
}

/**
 * Whether one grant allows one act.
 *
 * The three steps, in order, and the order matters: a statement that does not cover the
 * act is refused before any scope is read, so a grant's scope can never widen what its
 * role is.
 */
function grantAllows(grant: HeldGrant, request: AccessRequest): boolean {
  // A role name read off a database row, so it is a string and not a key of `roles`: a
  // row carrying a name no configuration declares grants nothing, which is the
  // fail-closed direction and the one a `team.role` written by hand would take.
  const declared: Readonly<Record<string, DeclaredRole | undefined>> = roles;
  const role = declared[grant.role];
  if (role === undefined) return false;

  // 1. The statements, through the plugin's own authorize function. Not its HTTP
  //    `hasPermission`, which needs the signed cookie this API does not hold.
  const verdict = role.authorize({ [request.resource]: [request.action] });
  if (!verdict.success) return false;

  // 2. The scope, against the act's environment and form.
  if (isEnvironmentScoped(request.resource, request.action)) {
    if (request.environment === undefined) return false;
    if (!scopeAllows(grant.environments, request.environment)) return false;
  }
  if (isFormScoped(request.resource, request.action)) {
    if (request.formId === undefined) return false;
    if (!scopeAllows(grant.forms, request.formId)) return false;
  }

  // 3. The matrix's production split. A production write on the control plane belongs to
  //    a `forms.approver`, so a `forms.editor` holding `prod` in scope is still refused
  //    it: the scope says which environments the role reaches, and the matrix says this
  //    row is not the editor's at all. The data family has no such split - a
  //    `responses.viewer` with `prod` in scope reads production responses, which is what
  //    that grant is for.
  if (
    request.environment === PRODUCTION_ENVIRONMENT &&
    isEnvironmentScoped(request.resource, request.action) &&
    FORMS_FAMILY_RESOURCES.includes(request.resource) &&
    grant.role !== "forms.approver"
  ) {
    return false;
  }

  return true;
}

/**
 * The decision: does this caller's membership in this workspace allow this act?
 *
 * Every grant is tried and **the first that allows the act wins**, which is what "a user
 * holds as many grants as their job needs" means in code: a person who is a
 * `forms.editor` in `test` and a `forms.approver` in `prod` holds two rows and each act
 * is judged against the one that covers it, rather than against a rank computed from
 * both.
 *
 * A caller with **no** grant reaches nothing, and that includes a caller holding only the
 * empty `member` row (finding G): the row grants nothing, so it is tried and refused like
 * any other.
 */
export function decideAccess(input: {
  /** The `member` row's role, or `undefined` when the caller has no member row. */
  readonly memberRole: string | undefined;
  /** Every team grant the caller holds in this workspace. */
  readonly grants: readonly HeldGrant[];
  readonly request: AccessRequest;
}): AccessDecision {
  const held: HeldGrant[] = [...input.grants];
  if (input.memberRole !== undefined) {
    // The member row's role, as a grant with the whole scope. `forms.owner` is workspace
    // administration, which has no environment or form dimension at all, and the empty
    // `member` name grants nothing, so giving it `all` widens nothing.
    held.unshift({ role: input.memberRole, environments: [SCOPE_ALL], forms: [SCOPE_ALL] });
  }

  for (const grant of held) {
    if (grantAllows(grant, input.request)) {
      return {
        allowed: true,
        role: grant.role,
        ...(grant.name === undefined ? {} : { name: grant.name }),
      };
    }
  }

  return { allowed: false, reason: refusalReason(input.request) };
}

/**
 * Why an act was refused, in terms of what the caller would need.
 *
 * It names the **grant that would allow it**, never another person's grant and never
 * whether one exists: a refusal that said "ask Alice" would be a membership list for
 * somebody Q35 does not give one to.
 */
function refusalReason(request: AccessRequest): string {
  const where =
    request.environment === undefined ? "" : ` in the ${request.environment} environment`;
  const which = request.formId === undefined ? "" : ` for this form`;
  return (
    `This needs a grant carrying ${request.resource}: ${request.action}${where}${which} ` +
    "in the workspace that owns it. Your own grants are at GET /admin/me/access."
  );
}

/**
 * Which roles hold one act, derived from the statements rather than tabulated.
 *
 * The matrix as data, for the section 3.2 extension's tests and for the admin's own
 * explanation of a role. It answers the statement question only - the scope and the
 * production split are {@link decideAccess}' - so a caller that wants the whole cell asks
 * that function with an environment.
 */
export function rolesHolding(resource: Resource, action: string): readonly RoleName[] {
  return ROLE_NAMES.filter((name) => roles[name].authorize({ [resource]: [action] }).success);
}
