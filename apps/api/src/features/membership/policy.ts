// The permissions matrix in section 6 of `plan/environments-and-workspaces.md` is this
// module's specification. `forms.` roles and `responses.` roles are two families and
// neither implies any right in the other, so an owner or editor reaches no response
// without a `responses.` grant of its own (ADR-41, SEC-3).
//
// Environment and form conditions are never in a statement: they live in the grant's
// scope, because the auth plugin has no notion of a scoped role. `dynamicAccessControl`
// is deliberately unused: a run-time role could recreate a mixed-family role.

import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

// The list is closed: a tenth resource would be a row the matrix does not have.
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

export type Resource = (typeof RESOURCES)[number];

// Named for the act, not the HTTP verb: one verb spans several matrix cells with
// different holders.
export const ACTIONS = {
  question: ["read", "write"],
  form: ["read", "write", "publish", "preview", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
  // `dispose` is the eraser's row, not the viewer's: it is a disposition, not a read.
  // `history` is the tombstone list and no role holds it; it is installation-wide
  // operator state.
  response: ["read", "export", "erase", "dispose", "history"],
  membership: ["read", "write"],
  workspace: ["read", "update", "archive"],
  audit: ["read"],
} as const satisfies Record<Resource, readonly string[]>;

export type Action = (typeof ACTIONS)[Resource][number];

// `defaultStatements` is spread in so the plugin's own resources are in the vocabulary
// and no QCMS role declares them: a plugin endpoint checking `member: ["create"]` finds
// no holder, `forms.owner` included.
export const accessControl = createAccessControl({
  ...defaultStatements,
  ...ACTIONS,
});

const formsViewer = accessControl.newRole({
  question: ["read"],
  form: ["read"],
  release: ["read"],
  link: ["read"],
  webhook: ["read"],
});

// Deliberately reaches no response in any environment, whatever its environment scope.
const formsEditor = accessControl.newRole({
  question: ["read", "write"],
  form: ["read", "write", "publish", "preview", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
});

// The only role holding environment-scoped writes in `prod`. It deliberately does not
// draft, edit, publish or preview: a role that both authored and approved would defeat
// the two-person rule.
const formsApprover = accessControl.newRole({
  question: ["read"],
  form: ["read", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
});

// Administers a workspace and touches nothing inside it: no form, release, link, webhook
// or response row. An owner who should author needs a `forms.editor` grant of its own.
const formsOwner = accessControl.newRole({
  membership: ["read", "write"],
  workspace: ["read", "update", "archive"],
  audit: ["read"],
});

const responsesViewer = accessControl.newRole({
  response: ["read", "export"],
});

// Erases without reading or exporting: the separation is the point.
const responsesEraser = accessControl.newRole({
  response: ["erase", "dispose"],
});

// Every resource named with an empty action list rather than an empty object, so "grants
// nothing" is distinguishable from "declared against the wrong vocabulary".
const emptyStatements = Object.fromEntries(
  Object.keys({ ...defaultStatements, ...ACTIONS }).map((resource) => [resource, []]),
) as Record<string, never[]>;

// The plugin's `admin`, `member` and `owner` are overridden with empty statements: left
// as the library ships them, a row carrying one of those names would hold the library's
// full organisation statements.
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

// Narrowed to `authorize` because the nine roles' `statements` have nine shapes, which
// would make the lookup below unassignable.
interface DeclaredRole {
  authorize(request: Record<string, readonly string[]>): { readonly success: boolean };
}

export const ROLE_NAMES = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "forms.owner",
  "responses.viewer",
  "responses.eraser",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const EMPTY_ROLE_NAMES = ["admin", "member", "owner"] as const;

// Separate from `@roonga/qcms-db`'s identically-valued `UNDROPPABLE_ENVIRONMENT`: a
// different rule that happens to land on the same word.
export const PRODUCTION_ENVIRONMENT = "prod";

// Only writes and data-plane reads. Authoring, publishing, preview and configuration
// reads are workspace-wide, so they are deliberately absent.
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

// The data family only: authoring roles stay workspace-wide.
const FORM_SCOPED: readonly `${Resource}:${string}`[] = [
  "response:read",
  "response:export",
  "response:erase",
  "response:dispose",
];

// The control plane, which is the family the production split governs.
const FORMS_FAMILY_RESOURCES: readonly Resource[] = [
  "question",
  "form",
  "release",
  "link",
  "webhook",
];

export function isEnvironmentScoped(resource: Resource, action: string): boolean {
  return ENVIRONMENT_SCOPED.includes(`${resource}:${action}`);
}

export function isFormScoped(resource: Resource, action: string): boolean {
  return FORM_SCOPED.includes(`${resource}:${action}`);
}

export interface HeldGrant {
  readonly role: string;
  // `["all"]`, or one or more environment names.
  readonly environments: readonly string[];
  // `["all"]`, or one or more form ids.
  readonly forms: readonly string[];
  readonly name?: string;
}

export interface AccessRequest {
  readonly resource: Resource;
  readonly action: string;
  readonly environment?: string | undefined;
  readonly formId?: string | undefined;
}

export interface AccessDecision {
  readonly allowed: boolean;
  readonly role?: string;
  readonly name?: string;
  // Must never name another person's grant, or whether one exists.
  readonly reason?: string;
}

const SCOPE_ALL = "all";

function scopeAllows(scope: readonly string[], value: string | undefined): boolean {
  if (scope.length === 1 && scope[0] === SCOPE_ALL) return true;
  return value !== undefined && scope.includes(value);
}

// The step order matters: a statement that does not cover the act is refused before any
// scope is read, so a grant's scope can never widen what its role is.
function grantAllows(grant: HeldGrant, request: AccessRequest): boolean {
  // The role name comes off a database row, so an undeclared name grants nothing, which
  // is the fail-closed direction.
  const declared: Readonly<Record<string, DeclaredRole | undefined>> = roles;
  const role = declared[grant.role];
  if (role === undefined) return false;

  // `authorize`, not the plugin's HTTP `hasPermission`, which needs a signed cookie this
  // API does not hold.
  const verdict = role.authorize({ [request.resource]: [request.action] });
  if (!verdict.success) return false;

  if (isEnvironmentScoped(request.resource, request.action)) {
    if (request.environment === undefined) return false;
    if (!scopeAllows(grant.environments, request.environment)) return false;
  }
  if (isFormScoped(request.resource, request.action)) {
    if (request.formId === undefined) return false;
    if (!scopeAllows(grant.forms, request.formId)) return false;
  }

  // The production split: a control-plane write in `prod` belongs to a `forms.approver`,
  // so a `forms.editor` with `prod` in scope is still refused it. The data family has no
  // such split.
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

// Each act is judged against whichever single grant covers it, never against a rank
// computed across grants.
export function decideAccess(input: {
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
  readonly request: AccessRequest;
}): AccessDecision {
  const held: HeldGrant[] = [...input.grants];
  if (input.memberRole !== undefined) {
    // `all` scope widens nothing here: `forms.owner` has no environment or form
    // dimension and the empty `member` role grants nothing.
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

// Names only the grant the caller would need. Naming a holder would leak a membership
// list to a caller with no right to one.
function refusalReason(request: AccessRequest): string {
  const where =
    request.environment === undefined ? "" : ` in the ${request.environment} environment`;
  const which = request.formId === undefined ? "" : ` for this form`;
  return (
    `This needs a grant carrying ${request.resource}: ${request.action}${where}${which} ` +
    "in the workspace that owns it. Your own grants are at GET /admin/me/access."
  );
}

// Authorises nothing: it only decides how much of an already-authorised read's answer a
// caller is shown. Scopes and the production split are ignored on purpose, since they
// govern writes and the reads in question are workspace-wide.
export function holdsStatement(
  input: {
    readonly memberRole: string | undefined;
    readonly grants: readonly HeldGrant[];
  },
  resource: Resource,
  action: string,
): boolean {
  const declared: Readonly<Record<string, DeclaredRole | undefined>> = roles;
  const names = [
    ...(input.memberRole === undefined ? [] : [input.memberRole]),
    ...input.grants.map((grant) => grant.role),
  ];
  return names.some((name) => declared[name]?.authorize({ [resource]: [action] }).success === true);
}

// Statements only: a caller that needs the scope or the production split asks
// `decideAccess` with an environment instead.
export function rolesHolding(resource: Resource, action: string): readonly RoleName[] {
  return ROLE_NAMES.filter((name) => roles[name].authorize({ [resource]: [action] }).success);
}
