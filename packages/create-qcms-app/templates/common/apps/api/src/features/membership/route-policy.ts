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
 * may call it fails closed and says so, rather than being open and silent. The refusal is
 * the middleware's, at runtime, and it asks the **router** whether a path is served
 * rather than asking this table - the first version asked the table, which is circular,
 * and served a route it had never heard of (PR #1061's review).
 * `route-policy.test.ts` closes the loop the other way by deriving the mounted route set
 * from the shipped OpenAPI document, so a route with no row is a red gate before it is
 * ever a refusal in production.
 *
 * # What a row says
 *
 * The (resource, action) the route is - or **two**, where a route is two acts, or **any
 * one of several**, where a route is one screen several grants reach - where its
 * **workspace** comes from, whether the act names an **environment** and **where that
 * environment is read from**, and whether it names a **form**. Nothing in a row is about
 * the caller: the caller's grants are read at the request, and `policy.ts` is what judges
 * them.
 *
 * # The installation claim
 *
 * Four rows are the claim's alone (Q29): creating a workspace, marking the shared one,
 * the installation-wide dead-letter list and the erasure log. The claim **administers and reads no data
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
   * True when the act names an environment. The policy refuses an environment-scoped act
   * that names none, so this and `isEnvironmentScoped` have to agree -
   * `route-policy.test.ts` asserts they do.
   */
  readonly namesEnvironment?: true;
  /**
   * **Where that environment comes from**, which every `namesEnvironment` row states.
   *
   * `"body"` for a route whose declared request body carries `environment` and whose
   * handler reads it; `"switcher"` for a route whose handler reads the Q6 switcher's
   * header. The rule it exists to keep is the one PR #1061's review broke with a probe:
   * **the environment the policy checks is exactly the environment the handler acts in**.
   *
   * Reading the body first and falling back to the switcher looked equivalent and was not.
   * Four of these routes declare **no body**, and `@hono/zod-openapi` validates only what
   * a route declares, so a `forms.editor` scoped to `test` could send
   * `x-qcms-environment: prod` with `{"environment":"test"}`, be authorised against
   * `test`, and have the handler revoke a **production** link.
   *
   * `route-policy.test.ts` asserts every row's answer against the **shipped OpenAPI
   * document** - a `"body"` row's schema carries `environment` and a `"switcher"` row's
   * does not - so a row that claims the wrong source is a red test rather than a bypass.
   *
   * `"query"` is the third source (Code Owner, 2026-10-29, Q87): the environment is an
   * explicit query parameter, which is what the Operations context is - a selection the
   * caller made rather than a switcher a browser remembered. The rule above is unchanged,
   * because the handler reads the same parameter: `route-policy.test.ts` asserts a
   * `"query"` row declares an `environment` query parameter in the shipped document and no
   * `environment` in a body.
   */
  readonly environmentFrom?: "body" | "switcher" | "query";
  /**
   * The cells a row admits **any one of**, where no single cell can authorise the route
   * without widening one (Code Owner, 2026-10-29, Q87).
   *
   * One route needs it: `GET /admin/operations/forms` is the Operations discovery query,
   * and the whole of D3 is that five different grants reach it and each sees a different
   * projection of a different subset of forms. Giving it `form: read` alone would strand
   * every `responses.*` holder (G02); giving it `response: read` alone would hand a
   * `forms.viewer` a cell the matrix does not give them.
   *
   * **A row's `resource`/`action` stays its primary cell**, and `anyOf` names every cell
   * the route admits, the primary included. The middleware admits a caller who holds at
   * least one of them **as a statement** in at least one of their workspaces and refuses
   * everybody else; it narrows nothing further, because the narrowing is per form and per
   * cell and belongs to the handler, which gets the middleware's own resolved grants on
   * the context rather than resolving them a second time.
   *
   * That split is deliberate and is the one place this table hands a decision onward.
   * An `anyOf` row's two scopes cannot be decided here: `response: read` is form-scoped,
   * and this route names no form in its path, so there is no form id for
   * {@link decideAccess} to judge until the handler has a row in hand. What the middleware
   * can prove - that this caller holds some operational cell somewhere - is what it
   * proves, and the handler asks the same decision function per (form, cell, environment)
   * before it puts a single field in a row. A caller holding nothing in the requested
   * environment therefore gets an **empty page rather than a 403** (G12), and a caller
   * holding no operational cell at all is refused.
   */
  readonly anyOf?: readonly { readonly resource: Resource; readonly action: string }[];
  /**
   * A **second** cell this route also requires, evaluated against the same workspace and
   * the same environment.
   *
   * One route needs it: `POST /forms/{id}/publish-and-release` is F2's convenience, and it
   * is **two** acts - a publish and a release into the environment its body names. The
   * first version gave it the publish cell alone and left the release half to the handler,
   * which never asked, so a `forms.editor` reached a production release through the
   * route F2 added to make releasing convenient (PR #1061's review).
   *
   * It lives on the row rather than in the handler for the reason the whole table does: a
   * handler that has to remember a check is a handler that can forget one, and the
   * forgetting is silent. Here both cells are evaluated before any handler runs, and the
   * refusal names whichever one failed.
   */
  readonly also?: { readonly resource: Resource; readonly action: string };
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
 * The cells that make a caller an **operational** caller (Code Owner, 2026-10-29, Q87).
 *
 * The four acts somebody performs against a form's live data in one environment: reading
 * its control-plane state, reading its responses, erasing one, and releasing a withheld
 * one. Their union is what `GET /admin/operations/forms` admits and what the Operations
 * capability on `GET /admin/me/access` reports (F1), so the two cannot disagree about who
 * has an Operations area at all - which is G12's point, since a navigation contract that
 * offered a mode the route then refused would be a 403 the shell walked into.
 *
 * `form: read` rather than `release: read` for the control-plane half, because the forms
 * table's own fields are the form's: a caller who may not read the form has no business
 * being told which version is serving it. The two always travel together in the matrix.
 */
export const OPERATIONAL_CELLS: readonly {
  readonly resource: Resource;
  readonly action: string;
}[] = [
  { resource: "form", action: "read" },
  { resource: "response", action: "read" },
  { resource: "response", action: "erase" },
  { resource: "response", action: "dispose" },
];

/**
 * Every admin route, as a cell of the matrix.
 *
 * Ordered by path so a reader can find a route, not by resource: the question a reader
 * arrives with is "who may call this", and they have the path.
 */
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  // --- the installation claim's four rows (Q29) ----------------------------------
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
  // --- the two flag-gated agent-authoring routes (task 041) ---
  //
  // **Mounted only when `QCMS_FLAG_AGENT_AUTHORING` is on, and absent from the shipped
  // OpenAPI document for exactly that reason** (`openapi-document.ts` generates with the
  // flag off). So the derivation in `route-policy.test.ts` cannot see them, and they had
  // no row until the runtime refusal of PR #1061's S2 fix made their absence a 403 in
  // their own suite. That is the derivation's blind spot found by the thing that was
  // supposed to be redundant with it, and the test now names these two rows explicitly.
  //
  // The cells follow the routes' own declared scopes rather than a new judgement: assist
  // is `forms:write`, and accept is `forms:write` **and** `questions:write`, because it
  // materialises the proposal's new questions as drafts in the library. Neither names an
  // environment: an agent turn and an accept both act on the draft, which is one object
  // per form and belongs to no environment.
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
    // F2's churn mitigation: one intent, one act, and **two cells of the matrix**. The
    // first version of this row carried the publish half and said "the handler asks for
    // the release half as well"; the handler never asked, and PR #1061's review probed
    // it: a `forms.editor` scoped to `test` got past the gate to a **production** release
    // through the route F2 added to make releasing convenient, which is the row "Release
    // to prod: `forms.approver`, prod in scope" and a pre-emption of task 070's
    // two-person rule.
    //
    // So the release half is on the row, in `also`, where the middleware evaluates it
    // before any handler runs. A handler that has to remember a check is a handler that
    // can forget one, and this is what forgetting looked like.
    method: "POST",
    path: "/admin/forms/{id}/publish-and-release",
    resource: "form",
    action: "publish",
    workspace: "form",
    also: { resource: "release", action: "create" },
    // The release half is environment-scoped and the body is where this route's
    // environment comes from, exactly as `POST /releases` takes it.
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
    // The candidate review (Code Owner, 2026-10-29, Q89; decision 5's read half). A
    // **read** of what a release of one source into each environment would do, and it
    // writes nothing at all: no version, no release row, no review token, no audit row.
    //
    // `release: read`, which is the three `forms.` roles' cell, and it names **no
    // environment**, which is the one thing to read twice on this row. The rule the
    // review of PR #1061 wrote is that the environment the policy checks is the
    // environment the handler acts in, and this handler **acts in none**: it reads
    // control-plane release rows and reports per target. The targets it reports are the
    // ones the caller holds `release: create` in, decided by the handler with the same
    // {@link decideAccess} the middleware uses, once per served environment, so a target
    // the caller could not release into is never named - the same shape as the Q7
    // erasure-scope row one slice over.
    //
    // A `POST` for a read because the source is a body (a draft or an exact version) and
    // because the phase 3 commit takes the same shape; it is idempotent and safe.
    method: "POST",
    path: "/admin/forms/{id}/release-review",
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
    // What is waiting for a second approver (Q30, Q51; task 070). The **endpoint read's**
    // cell, like the endpoint list above, and it names no environment for the same reason
    // that one does not: a configuration read is workspace-wide and environment-agnostic in
    // the matrix (Q39), because authoring roles are workspace-wide and only the write
    // actions are environment-scoped. The handler reads the switcher to choose which
    // environment's pending list to show, exactly as the endpoint list does.
    method: "GET",
    path: "/admin/forms/{id}/webhooks/proposals",
    resource: "webhook",
    action: "read",
    workspace: "form",
  },
  {
    // Confirming a pending endpoint change: `webhook: configure` in the switcher's
    // environment, so in `prod` the matrix's production split means only a
    // `forms.approver` holding `prod` in scope reaches it (069's `policy.ts`). That is
    // criterion 7's "a second account without `forms.approver` holding `prod` cannot
    // confirm", enforced by the same table as every other cell rather than by a check this
    // handler could forget.
    //
    // **`switcher`, and the handler compares the proposal's own environment against it.**
    // A `prod` proposal confirmed by a request whose switcher said `test` would be
    // authorised against `test`, where a `forms.editor` suffices - the exact bypass PR
    // #1061's review found one route over - so a mismatch is not found.
    //
    // No `audit` kind: the SEC-15 row rides the confirmation's own transaction on the
    // control pool, and the kinds this column names are the response-data ones plus the
    // grant family. The `setting` row this writes is Q61's, and the handler writes it
    // beside the state change rather than from this column.
    method: "POST",
    path: "/admin/forms/{id}/webhooks/proposals/{proposalId}/confirm",
    resource: "webhook",
    action: "configure",
    workspace: "form",
    namesEnvironment: true,
    environmentFrom: "switcher",
  },
  {
    // Withdrawing one. The same cell as confirming it, because ending a proposed
    // production change is the same authority as agreeing to one, and either account may
    // do it - which it was is in the audit.
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
    // The installation-wide dead-letter list. It names no form, so no workspace owns it,
    // and it carries delivery state rather than response content - the one answer-bearing
    // column an event can hold is redacted by the retention sweep (#329) and is not read
    // here. The claim's.
    method: "GET",
    path: "/admin/outbox/dead-letters",
    resource: "webhook",
    action: "read",
    workspace: "installation",
    installationOnly: true,
  },

  // --- Operations discovery: the one `anyOf` row --------------------------------
  {
    // D3 (Code Owner, 2026-10-29, Q87): the bounded Operations forms query. The union of
    // the caller's operational cells, because the screen it serves is the one place five
    // different grants meet - a `forms.viewer` reading release state, a `responses.viewer`
    // reading counts, an eraser with no read at all - and no single cell admits them
    // without widening one.
    //
    // `caller`, like the two library lists, because the answer is a filter and not a yes.
    // `query` for the environment, because the Operations context is an explicit selection
    // rather than a remembered switcher (C6 keeps the response and webhook rows as they
    // are: phase 4 sends the selection as that header).
    method: "GET",
    path: "/admin/operations/forms",
    resource: "form",
    action: "read",
    workspace: "caller",
    anyOf: OPERATIONAL_CELLS,
    namesEnvironment: true,
    environmentFrom: "query",
    // **No `audit` kind, and this is F4 rather than an omission** (Code Owner,
    // 2026-10-29, Q91): an aggregate response count is not a SEC-15 read and writes no
    // row. Showing one still needs `response: read` for that exact form and environment,
    // which the handler asks per row. SEC-15's `read` means somebody looked at answers,
    // and an audit that recorded every list render would bury the rows that do.
  },

  // --- responses: the data family, both dimensions ------------------------------
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
    // Q7's cross-environment offer (task 067). The **eraser's** cell, in the selected
    // environment, because asking where else an erasure would have to be repeated is part
    // of performing one: a caller who may not erase here has no business being told what
    // exists elsewhere. It names this form, so the data family's form scope narrows it
    // like every other response row.
    //
    // **The other environments are not this row's to authorise**, and that is the point of
    // the rule PR #1061's review wrote: the environment the policy checks is exactly the
    // environment the handler acts in, and this handler **acts in none of them** - it
    // reads existence and offers. It asks the same decision function, per environment,
    // before it includes one, so an offer the caller would be refused is never made.
    //
    // No `audit` kind: SEC-15's kinds are closed and `read` means a response read. This
    // reads whether a session id exists, which is what `GET /admin/erasures` reads and
    // writes no row for either.
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
    environmentFrom: "switcher",
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
 * The two admin routes that need no grant, each because it **is** an answer about what the
 * caller holds rather than an act on anything.
 *
 * `GET /admin/me/access` is the capability answer (Q35): everybody reads their own grants,
 * so a grant check in front of it would be a check on the thing it exists to tell you.
 *
 * `GET /admin/environments` is the live set, narrowed by its own handler to **the
 * environments the caller holds in some grant** (Q25) and served whole to the installation
 * claim. It is here rather than as a row because the matrix has no cell for it: every
 * role needs to know which environments it can act in - an approver to choose a release
 * target, a `responses.viewer` to choose whose responses to read, an owner to scope an
 * access group - and the matrix's environment row is about **settings**, which are the
 * operator command's and never reach HTTP at all. A caller holding nothing gets an empty
 * list, which is the same "reaches nothing" every other refusal gives them.
 *
 * **Two, and `route-policy.test.ts` asserts both the count and the names.** An exemption
 * list is the thing that grows, so each member carries its reason here rather than a flag
 * on a row, and a third is a change somebody reviews.
 */
export const GRANT_EXEMPT_ROUTES: readonly string[] = [
  "GET /admin/me/access",
  "GET /admin/environments",
];

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
