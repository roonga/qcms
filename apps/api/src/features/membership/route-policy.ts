// A route with **no row is refused**: failing closed beats open and silent (SEC-3,
// ADR-41). Whether a path is served is the router's question, not this table's.

import type { Resource } from "./policy.js";

// `caller` yields a filter rather than a yes: the handler narrows its read to the
// workspaces the caller holds the act in. `installation` means no workspace.
export type WorkspaceSource = "form" | "question" | "path" | "body" | "caller" | "installation";

export interface RoutePolicy {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  // As the OpenAPI document spells it; matched segment by segment, so a placeholder
  // matches exactly one segment.
  readonly path: string;
  readonly resource: Resource;
  readonly action: string;
  readonly workspace: WorkspaceSource;
  // Must agree with `isEnvironmentScoped`, since the policy refuses an
  // environment-scoped act that names no environment.
  readonly namesEnvironment?: true;
  // The policy's environment must be exactly the handler's. Four routes declare no body, so
  // a body-then-switcher fallback would let a `test` caller act on `prod`.
  readonly environmentFrom?: "body" | "switcher";
  // A second cell the route also requires, evaluated against the same workspace and
  // environment before any handler runs, so neither half can be forgotten.
  readonly also?: { readonly resource: Resource; readonly action: string };
  readonly namesForm?: true;
  // No role reaches the route: a caller holding every grant in the installation is still
  // refused.
  readonly installationOnly?: true;
  // Here rather than in the handler so "no path reads or exports without an audit row" is
  // checkable against the route list; the handlers write the row inside the read's own
  // transaction.
  readonly audit?: "read" | "export" | "erasure" | "grant" | "revoke" | "setting";
}

// Ordered by path, because a reader arrives with a path and the question "who may call
// this".
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  {
    method: "POST",
    path: "/admin/workspaces",
    resource: "workspace",
    action: "update",
    workspace: "installation",
    installationOnly: true,
  },
  {
    // Marking the shared question library changes what every other workspace may pin, so
    // it is not one workspace owner's to decide.
    method: "PUT",
    path: "/admin/workspaces/{id}/shared",
    resource: "workspace",
    action: "update",
    workspace: "installation",
    installationOnly: true,
  },

  {
    method: "GET",
    path: "/admin/workspaces",
    resource: "workspace",
    action: "read",
    workspace: "caller",
  },
  {
    method: "POST",
    path: "/admin/workspaces/{id}/archive",
    resource: "workspace",
    action: "archive",
    workspace: "path",
  },
  {
    method: "GET",
    path: "/admin/workspaces/{id}/members",
    resource: "membership",
    action: "read",
    workspace: "path",
  },
  {
    method: "PUT",
    path: "/admin/workspaces/{id}/members/{userId}",
    resource: "membership",
    action: "write",
    workspace: "path",
    audit: "grant",
  },
  {
    method: "GET",
    path: "/admin/workspaces/{id}/access-groups",
    resource: "membership",
    action: "read",
    workspace: "path",
  },
  {
    method: "POST",
    path: "/admin/workspaces/{id}/access-groups",
    resource: "membership",
    action: "write",
    workspace: "path",
  },
  {
    method: "PUT",
    path: "/admin/workspaces/{id}/access-groups/{teamId}",
    resource: "membership",
    action: "write",
    workspace: "path",
  },
  {
    method: "DELETE",
    path: "/admin/workspaces/{id}/access-groups/{teamId}",
    resource: "membership",
    action: "write",
    workspace: "path",
    audit: "revoke",
  },
  {
    method: "POST",
    path: "/admin/workspaces/{id}/access-groups/{teamId}/holders",
    resource: "membership",
    action: "write",
    workspace: "path",
    audit: "grant",
  },
  {
    method: "DELETE",
    path: "/admin/workspaces/{id}/access-groups/{teamId}/holders/{userId}",
    resource: "membership",
    action: "write",
    workspace: "path",
    audit: "revoke",
  },
  {
    method: "PUT",
    path: "/admin/workspaces/{id}/settings",
    resource: "workspace",
    action: "update",
    workspace: "path",
    audit: "setting",
  },
  {
    method: "GET",
    path: "/admin/workspaces/{id}/audit",
    resource: "audit",
    action: "read",
    workspace: "path",
  },

  // The capability endpoint has no row deliberately: it reports what the caller holds, so
  // a grant check in front of it would check the thing it exists to tell you. It is named
  // in `GRANT_EXEMPT_ROUTES` instead.

  {
    // The handler adds the shared question library to the caller's own workspaces. Shared
    // questions are the only thing that crosses a workspace boundary; no response does.
    method: "GET",
    path: "/admin/questions",
    resource: "question",
    action: "read",
    workspace: "caller",
  },
  {
    method: "POST",
    path: "/admin/questions",
    resource: "question",
    action: "write",
    workspace: "body",
  },
  {
    method: "GET",
    path: "/admin/questions/{id}",
    resource: "question",
    action: "read",
    workspace: "question",
  },
  {
    method: "POST",
    path: "/admin/questions/{id}/versions",
    resource: "question",
    action: "write",
    workspace: "question",
  },
  {
    method: "PUT",
    path: "/admin/questions/{id}/versions/{v}",
    resource: "question",
    action: "write",
    workspace: "question",
  },
  {
    method: "POST",
    path: "/admin/questions/{id}/versions/{v}/deprecate",
    resource: "question",
    action: "write",
    workspace: "question",
  },
  {
    method: "GET",
    path: "/admin/questions/{id}/versions/{v}/preview",
    resource: "question",
    action: "read",
    workspace: "question",
  },
  {
    method: "POST",
    path: "/admin/questions/{id}/versions/{v}/publish",
    resource: "question",
    action: "write",
    workspace: "question",
  },
  {
    // This row names the **source** workspace; the handler checks the target separately.
    method: "POST",
    path: "/admin/questions/{id}/workspace",
    resource: "workspace",
    action: "update",
    workspace: "question",
  },

  {
    method: "GET",
    path: "/admin/forms",
    resource: "form",
    action: "read",
    workspace: "caller",
  },
  { method: "POST", path: "/admin/forms", resource: "form", action: "write", workspace: "body" },
  { method: "GET", path: "/admin/forms/{id}", resource: "form", action: "read", workspace: "form" },
  {
    method: "PUT",
    path: "/admin/forms/{id}/draft",
    resource: "form",
    action: "write",
    workspace: "form",
  },
  // The agent-authoring routes exist only under `QCMS_FLAG_AGENT_AUTHORING`, so the test's
  // route derivation cannot see them; name their rows here or they become a 403.
  {
    method: "POST",
    path: "/admin/forms/{id}/draft/assist",
    resource: "form",
    action: "write",
    workspace: "form",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/draft/assist/accept",
    resource: "form",
    action: "write",
    workspace: "form",
    also: { resource: "question", action: "write" },
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/draft/validate",
    resource: "form",
    action: "write",
    workspace: "form",
  },
  {
    // Environment-agnostic: it writes nothing and reads no response.
    method: "POST",
    path: "/admin/forms/{id}/draft/preview",
    resource: "form",
    action: "preview",
    workspace: "form",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/draft/preview-condition",
    resource: "form",
    action: "preview",
    workspace: "form",
  },
  {
    method: "PATCH",
    path: "/admin/forms/{id}/settings",
    resource: "form",
    action: "write",
    workspace: "form",
  },
  {
    method: "GET",
    path: "/admin/forms/{id}/versions/{v}",
    resource: "form",
    action: "read",
    workspace: "form",
  },
  {
    // Publishing releases a version nowhere, so it names no environment and an author
    // needs one grant rather than one per environment.
    method: "POST",
    path: "/admin/forms/{id}/publish",
    resource: "form",
    action: "publish",
    workspace: "form",
  },
  {
    // Two acts: without the `also` release half, a `forms.editor` scoped to `test`
    // reaches a production release through this route.
    method: "POST",
    path: "/admin/forms/{id}/publish-and-release",
    resource: "form",
    action: "publish",
    workspace: "form",
    also: { resource: "release", action: "create" },
    namesEnvironment: true,
    environmentFrom: "body",
  },
  {
    method: "GET",
    path: "/admin/forms/{id}/releases",
    resource: "release",
    action: "read",
    workspace: "form",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/releases",
    resource: "release",
    action: "create",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "body",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/close",
    resource: "form",
    action: "close",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "body",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/reopen",
    resource: "form",
    action: "close",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "body",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/workspace",
    resource: "workspace",
    action: "update",
    workspace: "form",
  },

  {
    method: "GET",
    path: "/admin/forms/{id}/links",
    resource: "link",
    action: "read",
    workspace: "form",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/links",
    resource: "link",
    action: "mint",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "body",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/links/{linkId}/revoke",
    resource: "link",
    action: "revoke",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },

  {
    method: "GET",
    path: "/admin/forms/{id}/webhooks",
    resource: "webhook",
    action: "read",
    workspace: "form",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/webhooks",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    method: "PUT",
    path: "/admin/forms/{id}/webhooks/{webhookId}",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    method: "DELETE",
    path: "/admin/forms/{id}/webhooks/{webhookId}",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    // A configuration read, so workspace-wide and naming no environment; the handler
    // still reads the switcher to choose which environment's pending list to show.
    method: "GET",
    path: "/admin/forms/{id}/webhooks/proposals",
    resource: "webhook",
    action: "read",
    workspace: "form",
  },
  {
    // The handler must compare the proposal's own environment against the switcher's: a
    // `prod` proposal confirmed under a `test` switcher would be authorised against
    // `test`, where a `forms.editor` suffices.
    method: "POST",
    path: "/admin/forms/{id}/webhooks/proposals/{proposalId}/confirm",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    // Same cell as confirming: ending a proposed production change is the same authority
    // as agreeing to one.
    method: "DELETE",
    path: "/admin/forms/{id}/webhooks/proposals/{proposalId}",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    method: "GET",
    path: "/admin/forms/{id}/deliveries",
    resource: "webhook",
    action: "read",
    workspace: "form",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/deliveries/{deliveryId}/redeliver",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    // Installation-wide and safe to be so: it carries delivery state, never response
    // content.
    method: "GET",
    path: "/admin/outbox/dead-letters",
    resource: "webhook",
    action: "read",
    workspace: "installation",
    installationOnly: true,
  },

  {
    method: "GET",
    path: "/admin/forms/{id}/responses",
    resource: "response",
    action: "read",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
    namesForm: true,
    audit: "read",
  },
  {
    method: "GET",
    path: "/admin/forms/{id}/responses/{sessionId}",
    resource: "response",
    action: "read",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
    namesForm: true,
    audit: "read",
  },
  {
    method: "GET",
    path: "/admin/forms/{id}/export",
    resource: "response",
    action: "export",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
    namesForm: true,
    audit: "export",
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/responses/{sessionId}/erase",
    resource: "response",
    action: "erase",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
    namesForm: true,
    audit: "erasure",
  },
  {
    // The eraser's cell in the selected environment. The handler re-asks per environment
    // before including another, so a caller is not told what exists elsewhere.
    method: "GET",
    path: "/admin/forms/{id}/responses/{sessionId}/erasure-scope",
    resource: "response",
    action: "erase",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
    namesForm: true,
  },
  {
    // A disposition on response data rather than a read, so it is the eraser's row.
    method: "POST",
    path: "/admin/forms/{id}/responses/{sessionId}/unflag",
    resource: "response",
    action: "dispose",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
    namesForm: true,
  },
  {
    // The tombstone list carries no answer content, so installation-wide operator state
    // rather than a response read.
    method: "GET",
    path: "/admin/erasures",
    resource: "response",
    action: "history",
    workspace: "installation",
    installationOnly: true,
  },
];

// Each is an answer about what the caller holds rather than an act on anything, and each
// narrows its own result to the caller's grants. An exemption list is the thing that
// grows, so a third member is a change somebody reviews.
export const GRANT_EXEMPT_ROUTES: readonly string[] = [
  "GET /admin/me/access",
  "GET /admin/environments",
];

function matchesTemplate(template: string, path: string): boolean {
  const want = template.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, index) => segment.startsWith("{") || segment === got[index]);
}

// `undefined` is a refusal at the middleware, never a pass.
export function policyForRequest(method: string, path: string): RoutePolicy | undefined {
  // Most literal segments wins, so a literal beats a placeholder where both match.
  const candidates = ROUTE_POLICIES.filter(
    (row) => row.method === method && matchesTemplate(row.path, path),
  );
  const first = candidates[0];
  if (first === undefined || candidates.length === 1) return first;
  return candidates.reduce(
    (best, row) => (literalSegments(row.path) > literalSegments(best.path) ? row : best),
    first,
  );
}

function literalSegments(template: string): number {
  return template.split("/").filter((segment) => !segment.startsWith("{")).length;
}
