// Specification: `docs/WORKSPACE_ACCESS.md` section 3. A grant is an access group: a set of
// roles and one environment set. Roles are additive across groups, and the environment set
// governs the environment-scoped acts alone; `dynamicAccessControl` stays unused.

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
// no holder, the Workspace administrator role included.
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

// Drafts and previews and nothing else in an environment: freezing a version is the
// publisher's cell, and this role deliberately reaches no response.
const formsEditor = accessControl.newRole({
  question: ["read", "write"],
  form: ["read", "write", "preview"],
  release: ["read"],
  link: ["read"],
  webhook: ["read"],
});

// The only role holding environment-scoped control-plane acts. `form: publish` is here and
// not on the editor, so freezing a version always takes a publisher as well as an editor.
const formsPublisher = accessControl.newRole({
  question: ["read"],
  form: ["read", "publish", "close"],
  release: ["read", "create"],
  link: ["read", "mint", "revoke"],
  webhook: ["read", "configure"],
});

// Administers a workspace and touches nothing inside it: no form, release, link, webhook
// or response row. An administrator who should author needs a group grant of its own.
const workspaceAdministrator = accessControl.newRole({
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
  "forms.publisher": formsPublisher,
  "forms.owner": workspaceAdministrator,
  "responses.viewer": responsesViewer,
  "responses.eraser": responsesEraser,
  admin: accessControl.newRole(emptyStatements),
  member: accessControl.newRole(emptyStatements),
  owner: accessControl.newRole(emptyStatements),
} as const;

// Narrowed to `authorize` because the declared roles' `statements` have different shapes,
// which would make the lookup below unassignable.
interface DeclaredRole {
  authorize(request: Record<string, readonly string[]>): { readonly success: boolean };
}

// The five access-group roles and the Workspace administrator, which is the member row's
// flag rather than a group's role.
export const ROLE_NAMES = [
  "forms.viewer",
  "forms.editor",
  "forms.publisher",
  "forms.owner",
  "responses.viewer",
  "responses.eraser",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const EMPTY_ROLE_NAMES = ["admin", "member", "owner"] as const;

// Separate from `@roonga/qcms-db`'s identically-valued `UNDROPPABLE_ENVIRONMENT`: a
// different rule that happens to land on the same word.
export const PRODUCTION_ENVIRONMENT = "prod";

// Only writes and data-plane reads. Authoring, publishing a version, preview and
// configuration reads are workspace-wide, so they are deliberately absent.
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

export function isEnvironmentScoped(resource: Resource, action: string): boolean {
  return ENVIRONMENT_SCOPED.includes(`${resource}:${action}`);
}

export interface HeldGrant {
  readonly roles: readonly string[];
  // The group's environment set, empty where every role in it ignores one.
  readonly environments: readonly string[];
  readonly name?: string;
}

export interface AccessRequest {
  readonly resource: Resource;
  readonly action: string;
  readonly environment?: string | undefined;
}

export interface AccessDecision {
  readonly allowed: boolean;
  readonly role?: string;
  readonly name?: string;
  // Must never name another person's grant, or whether one exists.
  readonly reason?: string;
}

// The step order matters: a role that does not cover the act is passed over before any
// environment is read, so a group's environment set can never widen what its roles are.
function roleAllows(grant: HeldGrant, roleName: string, request: AccessRequest): boolean {
  // The role name comes off a database row, so an undeclared name grants nothing, which
  // is the fail-closed direction.
  const declared: Readonly<Record<string, DeclaredRole | undefined>> = roles;
  const role = declared[roleName];
  if (role === undefined) return false;

  // `authorize`, not the plugin's HTTP `hasPermission`, which needs a signed cookie this
  // API does not hold.
  if (!role.authorize({ [request.resource]: [request.action] }).success) return false;

  if (isEnvironmentScoped(request.resource, request.action)) {
    if (request.environment === undefined) return false;
    if (!grant.environments.includes(request.environment)) return false;
  }
  return true;
}

// Each act is judged against whichever single role covers it, never against a rank
// computed across grants.
export function decideAccess(input: {
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
  readonly request: AccessRequest;
}): AccessDecision {
  const held: HeldGrant[] = [...input.grants];
  if (input.memberRole !== undefined) {
    // The administrator role has no environment dimension and the empty `member` role
    // grants nothing, so an empty environment set loses neither.
    held.unshift({ roles: [input.memberRole], environments: [] });
  }

  for (const grant of held) {
    for (const roleName of grant.roles) {
      if (roleAllows(grant, roleName, input.request)) {
        return {
          allowed: true,
          role: roleName,
          ...(grant.name === undefined ? {} : { name: grant.name }),
        };
      }
    }
  }

  return { allowed: false, reason: refusalReason(input.request) };
}

// Names only the grant the caller would need. Naming a holder would leak a membership
// list to a caller with no right to one.
function refusalReason(request: AccessRequest): string {
  const where =
    request.environment === undefined ? "" : ` in the ${request.environment} environment`;
  return (
    `This needs a grant carrying ${request.resource}: ${request.action}${where} ` +
    "in the workspace that owns it. Your own grants are at GET /admin/me/access."
  );
}

// Authorises nothing: it only decides how much of an already-authorised read's answer a
// caller is shown. The environment set is ignored on purpose, since it governs writes and
// the reads in question are workspace-wide.
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
    ...input.grants.flatMap((grant) => [...grant.roles]),
  ];
  return names.some((name) => declared[name]?.authorize({ [resource]: [action] }).success === true);
}

// Statements only: a caller that needs the environment set asks `decideAccess` with an
// environment instead.
export function rolesHolding(resource: Resource, action: string): readonly RoleName[] {
  return ROLE_NAMES.filter((name) => roles[name].authorize({ [resource]: [action] }).success);
}
