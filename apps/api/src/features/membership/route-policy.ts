/**
 * Which cell of the permissions matrix each admin route is (SEC-3, ADR-41; task 069).
 *
 * # Why a table and not a check in every handler
 *
 * ADR-41 asks for enforcement "per route group and per route", and there are two ways to
 * write that. A call at the top of each handler is one, and it has a failure mode this
 * project has already met twice: a new route lands and nobody remembers the call, so the
 * route is served to anybody the group's gate let in and every test still passes. The
 * same shape as the surfaces inventory of task 040, and the same answer - the rows are
 * **data**, the middleware walks them, and a route with **no row is refused**.
 *
 * That is the property worth having: an admin route added without a decision about who
 * may call it fails closed and says so, rather than being open and silent.
 * `route-policy.test.ts` closes the loop the other way by deriving the mounted route set
 * from the shipped OpenAPI document, so a route with no row is a red gate before it is
 * ever a refusal in production.
 *
 * # What a row says
 *
 * The (resource, action) the route is, where its **workspace** comes from, and whether
 * the act names an **environment** or a **form**. Nothing in a row is about the caller:
 * the caller's grants are read at the request, and `policy.ts` is what judges them.
 *
 * # The installation claim
 *
 * Four rows are the claim's alone (Q29): creating a workspace, marking the shared one,
 * the environment list and the user accounts. The claim **administers and reads no data
 * anywhere**, so no row below gives it a response read - that is the matrix's `never`
 * row, and it is a decision rather than an omission.
 */

import type { Resource } from "./policy.js";

/**
 * Where a route's workspace comes from.
 *
 *   - **`form`**: the form named by the `{id}` path segment owns it. The ordinary case,
 *     and `control.forms.workspace_id` is where it is read from (task 068).
 *   - **`question`**: the question named by `{id}` owns it.
 *   - **`path`**: the `{id}` segment **is** the workspace id. The workspace routes.
 *   - **`body`**: the request body's optional `workspaceId`, resolved the way task 068
 *     resolves it for a new form or question - that workspace, or the installation's only
 *     one, or a refusal naming the candidates. The create routes, which have no form or
 *     question to read an owner off yet.
 *   - **`caller`**: **every** workspace the caller holds the action in, rather than one.
 *     The library lists, which are the one shape where the answer is a filter and not a
 *     yes: a `forms.viewer` in one workspace sees that workspace's forms, and ADR-41's
 *     whole premise is that two groups share an installation without seeing each other's
 *     forms and questions. The middleware resolves the set and the handler narrows its
 *     read to it.
 *   - **`installation`**: no workspace at all. The act is the installation claim's, so
 *     there is no membership to resolve.
 */
export type WorkspaceSource = "form" | "question" | "path" | "body" | "caller" | "installation";

/** One row: a route, the cell of the matrix it is, and where its subjects come from. */
export interface RoutePolicy {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * The path as the OpenAPI document spells it, including the `/admin` prefix and the
   * `{...}` placeholders. Matched segment by segment, so a placeholder matches one
   * segment and nothing else.
   */
  readonly path: string;
  readonly resource: Resource;
  readonly action: string;
  readonly workspace: WorkspaceSource;
  /**
   * True when the act names an environment, which the Q6 switcher's header carries. The
   * policy refuses an environment-scoped act that names none, so this and
   * `isEnvironmentScoped` have to agree - `route-policy.test.ts` asserts they do.
   */
  readonly namesEnvironment?: true;
  /** True when the act names a form, so the data family's form scope can narrow it. */
  readonly namesForm?: true;
  /**
   * True when the route is the installation claim's alone: no role reaches it, and a
   * caller holding every grant in the installation is still refused (Q29).
   */
  readonly installationOnly?: true;
  /**
   * The SEC-15 kind this route's act writes, where it writes one.
   *
   * On the table rather than in the handler so "no path reads or exports without a row"
   * is a property a reader can check against the route list (criterion 8). The handlers
   * are what write it, because the row rides the read's own transaction.
   */
  readonly audit?: "read" | "export" | "erasure" | "grant" | "revoke" | "setting";
}

/**
 * Every admin route, as a cell of the matrix.
 *
 * Ordered by path so a reader can find a route, not by resource: the question a reader
 * arrives with is "who may call this", and they have the path.
 */
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  // --- the installation claim's four rows (Q29) ----------------------------------
  {
    // The live environment set, which the Q6 switcher offers. The **switcher narrows it
    // to the environments the caller holds in some grant** (Q25), and that narrowing is
    // the handler's: the route itself is the installation's environment configuration,
    // which is the claim's.
    method: "GET",
    path: "/admin/environments",
    resource: "workspace",
    action: "read",
    workspace: "installation",
    installationOnly: true,
  },
  {
    method: "POST",
    path: "/admin/workspaces",
    resource: "workspace",
    action: "update",
    workspace: "installation",
    installationOnly: true,
  },
  {
    // Marking the shared question library changes what **every other** workspace may
    // pin, so it is not one workspace's owner's to decide (the matrix's last-but-one
    // row: "create workspaces, mark the shared one ... installation admin").
    method: "PUT",
    path: "/admin/workspaces/{id}/shared",
    resource: "workspace",
    action: "update",
    workspace: "installation",
    installationOnly: true,
  },

  // --- the workspace's own administration: `forms.owner` or the claim ------------
  {
    // The workspace list, narrowed to the workspaces the caller holds `workspace: read`
    // in - which is the ones they own (Q35) - and the whole set for the installation
    // claim, whose administration spans every workspace. An authoring grant holder does
    // not appear here and does not need to: their own workspaces come back from the
    // capability endpoint, which is what Q35 gives everybody.
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

  // --- the capability endpoint: every caller's own grants, and nobody else's -----
  //
  // No row, deliberately: it is not a cell of the matrix. Q35 gives the membership list
  // to owners and the claim, and gives **everybody** their own grants, so a grant check
  // in front of it would be a check on the thing it exists to tell you. The middleware
  // names it as the one admin route that needs no grant, and `route-policy.test.ts`
  // asserts that exemption is exactly one route long.

  // --- questions -----------------------------------------------------------------
  {
    // The question library list. `caller`, not one workspace: the handler narrows the
    // read to the workspaces the caller holds `question: read` in, plus the shared
    // question library, which every workspace's editors may see and pin from (finding
    // 10). The shared workspace's questions are the one thing that crosses a workspace
    // boundary, and no response ever does.
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
    // Moving a question between workspaces (Q14). An act on both workspaces, and the one
    // this row names is the **source**: the target is checked by the handler, which
    // refuses an archived one. An owner of neither cannot move a question out from under
    // a workspace they do not administer.
    method: "POST",
    path: "/admin/questions/{id}/workspace",
    resource: "workspace",
    action: "update",
    workspace: "question",
  },

  // --- forms ---------------------------------------------------------------------
  {
    // The form library list, narrowed to the caller's own workspaces for the reason the
    // question list is. There is no shared-library exception here: a form belongs to one
    // workspace and is never pinned from another.
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
  {
    method: "POST",
    path: "/admin/forms/{id}/draft/validate",
    resource: "form",
    action: "write",
    workspace: "form",
  },
  {
    // Q36: editor-only and environment-agnostic, because it writes nothing and reads no
    // response, so there is no environment to scope it to.
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
    // Publishing releases it nowhere (ADR-40), so it is workspace-wide and names no
    // environment. That asymmetry is load-bearing: an author needs one grant and not one
    // per environment.
    method: "POST",
    path: "/admin/forms/{id}/publish",
    resource: "form",
    action: "publish",
    workspace: "form",
  },
  {
    // F2's churn mitigation: one intent, one act. It is **two** cells of the matrix, so
    // the handler asks for the release half as well and this row is the publish half.
    method: "POST",
    path: "/admin/forms/{id}/publish-and-release",
    resource: "form",
    action: "publish",
    workspace: "form",
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
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/close",
    resource: "form",
    action: "close",
    workspace: "form",
    namesEnvironment: true,
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/reopen",
    resource: "form",
    action: "close",
    workspace: "form",
    namesEnvironment: true,
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/workspace",
    resource: "workspace",
    action: "update",
    workspace: "form",
  },

  // --- links ---------------------------------------------------------------------
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
  },
  {
    method: "POST",
    path: "/admin/forms/{id}/links/{linkId}/revoke",
    resource: "link",
    action: "revoke",
    workspace: "form",
    namesEnvironment: true,
  },

  // --- webhooks and the outbox ---------------------------------------------------
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
  },
  {
    method: "PUT",
    path: "/admin/forms/{id}/webhooks/{webhookId}",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
  },
  {
    method: "DELETE",
    path: "/admin/forms/{id}/webhooks/{webhookId}",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
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
  },
  {
    // The installation-wide dead-letter list. It names no form, so no workspace owns it,
    // and it carries delivery state rather than response content - the one answer-bearing
    // column an event can hold is redacted by the retention sweep (#329) and is not read
    // here. The claim's, like the environment list.
    method: "GET",
    path: "/admin/outbox/dead-letters",
    resource: "webhook",
    action: "read",
    workspace: "installation",
    installationOnly: true,
  },

  // --- responses: the data family, both dimensions ------------------------------
  {
    method: "GET",
    path: "/admin/forms/{id}/responses",
    resource: "response",
    action: "read",
    workspace: "form",
    namesEnvironment: true,
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
    namesForm: true,
    audit: "erasure",
  },
  {
    // Releasing a withheld response is a **disposition** on response data rather than a
    // read of it, so it is the eraser's row and carries its own action. It writes no
    // audit row, because it is neither a read, an export nor an erasure - SEC-15's kinds
    // are closed and a sixth was added for a setting rather than for this.
    method: "POST",
    path: "/admin/forms/{id}/responses/{sessionId}/unflag",
    resource: "response",
    action: "dispose",
    workspace: "form",
    namesEnvironment: true,
    namesForm: true,
  },
  {
    // The tombstone list: which sessions were erased, with **no answer content in it at
    // all** (ADR-17's existence without content). Installation-wide, so it names no
    // workspace and no form, and **no role holds it** - it is operator state, the
    // claim's, and Q29 is intact because a tombstone is not a response.
    method: "GET",
    path: "/admin/erasures",
    resource: "response",
    action: "history",
    workspace: "installation",
    installationOnly: true,
  },
];

/**
 * The one admin route that needs no grant: a caller's own capability answer (Q35).
 *
 * Exactly one, and `route-policy.test.ts` asserts that. An exemption list is the thing
 * that grows, so it is a constant with a reason beside it rather than a flag on a row.
 */
export const GRANT_EXEMPT_ROUTES: readonly string[] = ["GET /admin/me/access"];

/** Whether a concrete path matches a template, segment by segment. */
function matchesTemplate(template: string, path: string): boolean {
  const want = template.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, index) => segment.startsWith("{") || segment === got[index]);
}

/**
 * The row for one request, or `undefined` when there is none.
 *
 * `undefined` is a **refusal** at the middleware, not a pass: an admin route with no row
 * is a route nobody decided who may call, and serving it would be the failure this table
 * exists to prevent.
 */
export function policyForRequest(method: string, path: string): RoutePolicy | undefined {
  // The longest matching template wins, so a literal segment beats a placeholder: both
  // `/admin/forms/{id}/responses/{sessionId}` and a hypothetical
  // `/admin/forms/{id}/responses/latest` would match the same request shape, and the
  // literal is the more specific statement.
  const candidates = ROUTE_POLICIES.filter(
    (row) => row.method === method && matchesTemplate(row.path, path),
  );
  if (candidates.length <= 1) return candidates[0];
  return candidates.reduce((best, row) =>
    literalSegments(row.path) > literalSegments(best.path) ? row : best,
  );
}

function literalSegments(template: string): number {
  return template.split("/").filter((segment) => !segment.startsWith("{")).length;
}
