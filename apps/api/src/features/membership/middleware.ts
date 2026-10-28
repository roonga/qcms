/**
 * The grant middleware (SEC-3, ADR-41; task 069).
 *
 * Mounted on the **admin group**, after the admin-session gate and the Q6 environment
 * middleware, before every admin slice. Three steps per request:
 *
 *   1. find the request's row in `route-policy.ts`, and **refuse when there is none**;
 *   2. resolve the workspace the act is in, and the caller's grants there;
 *   3. decide, with `policy.ts`, and refuse with a 403 that names the grant needed.
 *
 * What it leaves on the context is the decision and the workspace, so a handler can read
 * the workspace it has already been authorised for rather than resolving it a second
 * time, and so the audit row can carry the workspace the act was performed in.
 *
 * # Why a refusal is the answer to an unknown route
 *
 * An admin route with no row is a route nobody decided who may call. Serving it would be
 * the drift this table exists to prevent - and it is drift this project has already met
 * twice, in tasks 065 and 068, where a new admin route missed the security suite's own
 * inventory and every test stayed green over it. So the failure direction is closed:
 * `route-policy.test.ts` makes it a red unit test, and this makes it a 403 if it ever
 * reaches production anyway.
 *
 * **The runtime half had to be fixed to be true.** The first version decided whether a
 * path was routed by asking whether any **row** matched it on any method, which is
 * circular: a route with no row on any method looked like a path the API does not serve,
 * and was served. It asks the router now (`isRoutedAdminPath`), and
 * `membership.integration.test.ts` mounts an admin route the table has never heard of to
 * prove the refusal rather than describe it (PR #1061's review).
 *
 * # Why this is a middleware and not a call in each handler
 *
 * ADR-41 asks for enforcement "per route group and per route". A call at the top of each
 * handler is the other way to write that, and its failure mode is a handler that forgets:
 * the route is then served to anybody the group's gate let in, silently. The table is the
 * matrix as data, which is the same answer task 040 gave for the probe inventory and for
 * the same reason.
 *
 * # R2 and SEC-3
 *
 * Nothing here runs in a BFF and nothing here is a UI concern. The admin app proxies to
 * this API; a caller that skips the admin entirely and presents a session token reaches
 * exactly this middleware, which is what criterion 10 asserts.
 */

import { getForm, getQuestion } from "@roonga/qcms-db";
import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";

import { parseFormId, parseQuestionId } from "@roonga/qcms-core";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { resolveWorkspaceForNewObject } from "../workspaces/resolve.js";
import type { AccessRequest } from "./policy.js";
import { decideAccess, holdsStatement } from "./policy.js";
import {
  holdsInstallationClaim,
  resolveCallerWorkspaces,
  resolveGrants,
  workspacesAllowing,
} from "./resolver.js";
import type { GrantContext, ResolvedMembership } from "./context.js";
import { GRANT_EXEMPT_ROUTES, type RoutePolicy, policyForRequest } from "./route-policy.js";

const fail = {
  /** An admin route nobody wrote a row for. Closed rather than open. */
  undecided: (method: string, path: string): ApiError =>
    new ApiError(
      "ROUTE_NOT_AUTHORIZED",
      403,
      `${method} ${path} has no entry in the authorisation matrix, so this deployment ` +
        "cannot say who may call it and refuses everybody. This is a defect in the " +
        "build rather than a property of your account.",
    ),
  refused: (reason: string): ApiError => new ApiError("FORBIDDEN", 403, reason),
  claimOnly: (): ApiError =>
    new ApiError(
      "FORBIDDEN",
      403,
      "This acts across every workspace, so it needs the installation-wide " +
        "administrator claim. A workspace's own grants do not reach it.",
    ),
  noWorkspace: (): ApiError => new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace"),
  notFound: (what: string): ApiError =>
    new ApiError(`${what.toUpperCase()}_NOT_FOUND`, 404, `No such ${what}`),
  noPrincipal: (): ApiError => new ApiError("unauthorized", 401, "Admin authentication required"),
  /**
   * A route whose own body carries the environment was sent one that names none.
   *
   * The field is required on every such route, so the validator refuses the request a
   * moment later anyway; this is the earlier half of the same answer, and it exists
   * because the alternative - falling back to the switcher - would authorise against an
   * environment the handler is not going to use.
   */
  environmentMissing: (): ApiError =>
    new ApiError(
      "INVALID_REQUEST",
      400,
      "This route acts in the environment its body names, so the body has to name one.",
    ),
  /**
   * A route that takes its environment from the switcher was sent a body naming one.
   *
   * Refused rather than ignored (PR #1061's review). Such a route declares no
   * `environment` field, so a body carrying one is a key nobody can have meant - and the
   * one caller who would send it is a caller trying to be authorised against one
   * environment while the handler acts in another.
   */
  /**
   * A route whose environment is an explicit query parameter was sent none (Q87).
   *
   * The Operations context is a selection, so there is nothing to fall back to: a
   * switcher header a browser remembered is exactly what this route does not read, and
   * authorising against it would authorise a caller for an environment they did not
   * choose.
   */
  environmentInQueryMissing: (): ApiError =>
    new ApiError(
      "INVALID_REQUEST",
      400,
      "This route acts in the environment its `environment` query parameter names, so the " +
        "request has to name one. There is no default: the operations context is an " +
        "explicit choice.",
    ),
  environmentNotInBody: (): ApiError =>
    new ApiError(
      "INVALID_REQUEST",
      400,
      "This route acts in the environment the switcher selects, so its body must not name " +
        "one. The environment a request is authorised for is the environment it is " +
        "performed in.",
    ),
} as const;

/** The `{id}` segment of a path, by the position the template puts it in. */
function segment(template: string, path: string, name: string): string | undefined {
  const want = template.split("/");
  const got = path.split("/");
  const index = want.indexOf(`{${name}}`);
  return index === -1 ? undefined : got[index];
}

/**
 * The workspace a `body` row acts in: the one the body names, or the installation's only
 * one.
 *
 * **Task 068's own resolver**, called rather than reimplemented. Its three outcomes - that
 * workspace, the only one, or a refusal naming the candidates - are what the create
 * handler will give the caller a moment later, so calling it here means the request is
 * authorised against exactly the workspace it is written into, and a refusal reads the
 * same whichever of the two raised it. A second implementation would be a second answer
 * to one question, which is how a request gets authorised against one workspace and
 * written into another.
 */
async function workspaceFromBody(deps: Deps, body: unknown): Promise<string> {
  const named = (body as { workspaceId?: unknown } | undefined)?.workspaceId;
  return resolveWorkspaceForNewObject(
    deps.databases.control,
    typeof named === "string" && named !== "" ? named : undefined,
  );
}

/** Read the JSON body, if there is one. Hono caches it, so the validator reads the same copy. */
async function readBody(c: Parameters<MiddlewareHandler<ApiEnv>>[0]): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (!type.includes("application/json")) return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the validator's refusal to report, not this middleware's.
    return undefined;
  }
}

/**
 * The environment an act names, read from **the source its own row declares**.
 *
 * # Why the source is per row rather than "body, else the switcher"
 *
 * The first version of this read the body first and fell back to the switcher, and the
 * review of PR #1061 broke it with a probe: four environment-naming routes **declare no
 * request body at all**, so their handler takes the environment from the switcher alone,
 * and `@hono/zod-openapi` validates only what a route declares - so nothing refused an
 * undeclared key. A `forms.editor` scoped to `test` sent `x-qcms-environment: prod` with
 * a body of `{"environment":"test"}`, was authorised against `test`, and the handler
 * revoked a **production** link. The same shape deactivated a production webhook,
 * redelivered a production delivery and unflagged a production response.
 *
 * The rule that closes it is the one the defect broke: **the environment the policy
 * checks is exactly the environment the handler acts in**. That is a property of the
 * route, not of a request, so the route says which: `environmentFrom: "body"` for a route
 * whose declared body carries `environment` and whose handler reads it, `"switcher"` for a
 * route whose handler reads `c.get("requestEnvironment")`. `route-policy.test.ts` asserts
 * each row's answer against the **shipped OpenAPI document**, so a row that claims the
 * wrong source is red rather than exploitable.
 *
 * # And a body naming an environment on a `switcher` row is refused outright
 *
 * Belt, and it is cheap: such a route declares no `environment`, so a body carrying one is
 * a key nobody can have meant. Ignoring it silently would leave the attack invisible,
 * which is how this defect survived a first review - the probe got a 200 and nothing said
 * why. The refusal names the key.
 */
async function environmentFor(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
): Promise<string | undefined> {
  if (policy.namesEnvironment !== true) return undefined;

  // The Q6 switcher's value, resolved through the same fallback the handler's own pool
  // selection uses, so the environment an act is authorised for is the environment it is
  // performed in.
  const switcher = deps.databases.forRequest(c.get("requestEnvironment")).environment;
  const named = (await readBody(c)) as { environment?: unknown } | undefined;
  const inBody = typeof named?.environment === "string" ? named.environment : undefined;

  if (policy.environmentFrom === "query") {
    // The Operations context, which is an explicit selection (Q87). Read from the same
    // query parameter the handler reads, for the reason the body and the switcher are
    // read where their own handlers read them. A request naming none is refused here
    // rather than defaulted: defaulting would authorise a caller against an environment
    // they did not choose, and the parameter is required on the one route that has it, so
    // the validator refuses it a moment later anyway.
    if (inBody !== undefined) throw fail.environmentNotInBody();
    const inQuery = new URL(c.req.url).searchParams.get("environment");
    if (inQuery === null || inQuery === "") throw fail.environmentInQueryMissing();
    return inQuery;
  }

  if (policy.environmentFrom === "body") {
    // The handler reads the body, so the body is what is authorised. A body that names
    // nothing is the validator's refusal to report, not this middleware's: the field is
    // required on every one of these routes, so the request fails validation a moment
    // later. Authorising against the switcher here instead would be this middleware
    // picking an environment the handler will not use.
    if (inBody === undefined || inBody === "") throw fail.environmentMissing();
    return inBody;
  }

  if (inBody !== undefined) throw fail.environmentNotInBody();
  return switcher;
}

/**
 * Where a row's act is, resolved.
 *
 *   - **`workspace`**: this workspace, and the act is judged against the grants in it.
 *   - **`none`**: no workspace, for an installation-wide or a `caller` row.
 *   - **`defer`**: the path segment is **not a well-formed id**, so there is no form or
 *     question for it to name and no workspace to judge against. The route's own handler
 *     answers, for the reason below.
 */
type WorkspaceResolution =
  | { readonly kind: "workspace"; readonly id: string }
  | { readonly kind: "none" }
  | { readonly kind: "defer" };

/**
 * The workspace a row's act is in.
 *
 * # Why a malformed id defers to the handler rather than being refused here
 *
 * The two statuses a malformed form id gets are **both deliberate and they differ per
 * route**: `GET /admin/forms/{id}/deliveries` answers 400 `INVALID_FORM_ID`, while
 * `POST /admin/forms/{id}/deliveries/{deliveryId}/redeliver` answers **404**, because
 * issue #310 took the 400 off that route so its document declares none and issue #305
 * then made "malformed form", "no such delivery" and "not your form" one answer, so the
 * response cannot be used to sort them. One middleware cannot answer both, and inventing
 * a third shape would undo one of those decisions.
 *
 * So a malformed id **defers**: the handler parses it and raises its own slice's refusal.
 * That is safe rather than a hole, because there is nothing to authorise - a string that
 * cannot name a form names no form, in any workspace - and because every form-addressed
 * handler parses its id before it reads or writes anything. An id that is well formed and
 * **absent** is a 404 here, which is the answer every slice already gives it.
 */
async function workspaceFor(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
  path: string,
): Promise<WorkspaceResolution> {
  switch (policy.workspace) {
    case "installation":
    case "caller":
      return { kind: "none" };
    case "path": {
      const id = segment(policy.path, path, "id");
      if (id === undefined || id === "") throw fail.noWorkspace();
      return { kind: "workspace", id };
    }
    case "body":
      return { kind: "workspace", id: await workspaceFromBody(deps, await readBody(c)) };
    case "form": {
      const parsed = parseFormId(segment(policy.path, path, "id") ?? "");
      if (!parsed.ok) return { kind: "defer" };
      const form = await getForm(deps.databases.control, parsed.value);
      if (form === undefined) throw fail.notFound("form");
      return { kind: "workspace", id: form.workspaceId };
    }
    case "question": {
      const parsed = parseQuestionId(segment(policy.path, path, "id") ?? "");
      if (!parsed.ok) return { kind: "defer" };
      const question = await getQuestion(deps.databases.control, parsed.value);
      if (question === undefined) throw fail.notFound("question");
      return { kind: "workspace", id: question.workspaceId };
    }
  }
}

/**
 * The middleware.
 *
 * `deps` rather than a bare executor, because resolving an environment goes through the
 * same pool selection the handler uses and resolving a form's workspace goes through the
 * control pool.
 */
export function grantCheck(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const principal = c.get("adminPrincipal");
    // The admin-session gate runs first and refuses an unauthenticated request, so this
    // is unreachable in the mounted order. It is a refusal rather than an assertion
    // because the order is a property of `registrars.ts` and this file cannot see it.
    if (principal === undefined) throw fail.noPrincipal();

    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    // The capability endpoint: everybody reads their own grants (Q35), so a grant check
    // in front of it would be a check on the thing it exists to tell you. Matched on the
    // concrete path because it takes no parameters.
    if (GRANT_EXEMPT_ROUTES.includes(`${method} ${path}`)) {
      await next();
      return;
    }

    const policy = policyForRequest(method, path);
    if (policy === undefined) {
      // **Refused, unless the router serves nothing here.**
      //
      // Not every unmatched path is an undecided route: a path the API does not serve at
      // all should 404 from the router rather than 403 from here, and a 403 on a path that
      // does not exist is an answer about authorisation to a question about routing.
      //
      // The first version told the two apart by asking whether any ROW matched the path on
      // any method, which is circular: a route with no row on any method looked like an
      // unrouted path and was served. PR #1061's review found it, and four documents
      // described this as a runtime refusal while the code did not do it.
      //
      // Hono knows the answer: `c.req.matchedRoutes` carries the handlers this request
      // matched, so a path the router will serve is one that matched something past the
      // middleware. That is what is asked now, and an admin path with no row is refused.
      if (!isRoutedAdminPath(c, path)) {
        await next();
        return;
      }
      throw fail.undecided(method, path);
    }

    const context = await decideRequest(deps, c, {
      policy,
      path,
      userId: principal.userId,
      claim: holdsInstallationClaim(principal.role),
    });
    if (context !== undefined) c.set("grantContext", context);
    await next();
  };
}

/**
 * Decide one request, and answer the context the handler reads.
 *
 * `undefined` means **defer**: the path carries an id that is not one, so there is
 * nothing to authorise and the handler raises its slice's own refusal (`workspaceFor`
 * says why that cannot be one status here). Every other outcome is either a context or a
 * thrown refusal.
 */
async function decideRequest(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  input: {
    readonly policy: RoutePolicy;
    readonly path: string;
    readonly userId: string;
    readonly claim: boolean;
  },
): Promise<GrantContext | undefined> {
  const { policy, path, claim } = input;

  // The acts the claim holds alone (Q29): creating a workspace, marking the shared
  // one and the installation-wide dead-letter list. No role reaches
  // them, so a caller holding every grant in the installation is still refused.
  if (policy.installationOnly === true) {
    if (!claim) throw fail.claimOnly();
    return { policy, ...(await claimContext(deps, c, policy, path)) };
  }

  const environment = await environmentFor(deps, c, policy);
  const request: AccessRequest = {
    resource: policy.resource,
    action: policy.action,
    ...(environment === undefined ? {} : { environment }),
  };

  // A library list: the answer is a filter rather than a yes, so the set of workspaces
  // the caller holds the act in is resolved and the handler narrows its read to it.
  if (policy.workspace === "caller") {
    const resolved = await resolveCallerWorkspaces(deps.databases.control, {
      userId: input.userId,
      claim,
    });
    if (policy.anyOf !== undefined) return anyOfContext(policy, resolved, environment);
    const workspaceIds = workspacesAllowing(resolved, request);
    if (workspaceIds.length === 0) {
      throw fail.refused(
        decideAccess({ memberRole: undefined, grants: [], request }).reason ?? "Refused",
      );
    }
    return { policy, workspaceIds, ...(environment === undefined ? {} : { environment }) };
  }

  const where = await workspaceFor(deps, c, policy, path);
  if (where.kind === "defer") return undefined;
  if (where.kind === "none") throw fail.noWorkspace();
  return decideInOneWorkspace(deps, {
    policy,
    path,
    userId: input.userId,
    claim,
    workspaceId: where.id,
    request,
    ...(environment === undefined ? {} : { environment }),
  });
}

/**
 * The context an `anyOf` row leaves behind, or a refusal (Q87).
 *
 * # What is decided here and what is deliberately not
 *
 * **Decided:** whether this caller is an operational caller at all - does any workspace
 * they hold a grant in declare any one of the row's cells. A caller holding none is
 * refused, naming the row's primary cell, because they have no Operations area: a
 * `forms.owner` alone and the installation claim alone reach no form cell anywhere (D3's
 * two "None" rows, G06).
 *
 * **Not decided:** which forms, and which fields of each. Neither scope can be judged
 * here - `response: read` is form-scoped and this route names no form in its path - so
 * the handler judges per (form, cell, environment) with the **memberships resolved here**,
 * which is why they travel on the context. The alternative is the thing this context
 * exists to prevent: a handler resolving the caller's grants a second time is a second
 * chance to disagree with the first.
 *
 * So a caller holding `response: read` in `test` who asks for `prod` is **admitted and
 * gets an empty page** (G12), not a 403: they hold the cell, and the environment narrows
 * the rows rather than the route. That distinction is what lets the shell tell "you have
 * no access here" from "there is nothing here" without guessing.
 */
function anyOfContext(
  policy: RoutePolicy,
  resolved: readonly ResolvedMembership[],
  environment: string | undefined,
): GrantContext {
  const cells = policy.anyOf ?? [];
  const holding = resolved.filter((membership) =>
    cells.some((cell) =>
      holdsStatement(
        { memberRole: membership.memberRole, grants: membership.grants },
        cell.resource,
        cell.action,
      ),
    ),
  );
  if (holding.length === 0) {
    throw fail.refused(
      decideAccess({
        memberRole: undefined,
        grants: [],
        request: { resource: policy.resource, action: policy.action },
      }).reason ?? "Refused",
    );
  }
  return {
    policy,
    workspaceIds: holding.map((membership) => membership.workspaceId),
    memberships: holding,
    ...(environment === undefined ? {} : { environment }),
  };
}

/** Decide an act in one named workspace, and answer the context it leaves behind. */
async function decideInOneWorkspace(
  deps: Deps,
  input: {
    readonly policy: RoutePolicy;
    readonly path: string;
    readonly userId: string;
    readonly claim: boolean;
    readonly workspaceId: string;
    readonly request: AccessRequest;
    readonly environment?: string;
  },
): Promise<GrantContext> {
  const { policy, path, workspaceId, request, environment } = input;
  // The form scope's value, for the data family. The form is the `{id}` segment, and
  // every row that names a form is a form-addressed route.
  const formId = policy.namesForm === true ? segment(policy.path, path, "id") : undefined;
  const resolved: ResolvedMembership = await resolveGrants(deps.databases.control, {
    userId: input.userId,
    workspaceId,
    claim: input.claim,
  });
  const scoped = { ...request, ...(formId === undefined ? {} : { formId }) };
  const decision = decideAccess({
    memberRole: resolved.memberRole,
    grants: resolved.grants,
    request: scoped,
  });
  if (!decision.allowed) throw fail.refused(decision.reason ?? "Refused");

  // The second cell, where a row has one: `publish-and-release` is a publish **and** a
  // release, and both are evaluated before any handler runs (PR #1061's review found the
  // release half unasked). Judged against the same workspace and the same environment,
  // and the refusal names whichever cell failed.
  if (policy.also !== undefined) {
    const second = decideAccess({
      memberRole: resolved.memberRole,
      grants: resolved.grants,
      request: { ...scoped, resource: policy.also.resource, action: policy.also.action },
    });
    if (!second.allowed) throw fail.refused(second.reason ?? "Refused");
  }

  return {
    policy,
    workspaceId,
    ...(environment === undefined ? {} : { environment }),
    ...(decision.role === undefined ? {} : { role: decision.role }),
    ...endpointUrlVisibility(policy, resolved),
  };
}

/**
 * How much of an endpoint's URL this caller is shown, on the rows where there is one
 * (Q58, task 067).
 *
 * Only the **endpoint read** gets a value, which is the one route that returns a stored
 * URL to a caller who may not be allowed to set it. The configure routes need none: a
 * caller who reached one holds `webhook: configure` by definition, and the URL it echoes
 * back is the one they just sent.
 *
 * It is `decision.role` that is **not** asked, deliberately. That field is whichever grant
 * happened to allow the read first, and a person holding both `forms.viewer` and
 * `forms.editor` would be masked or not depending on the order their grants came back
 * from the database - a response that varies with a row order is a response nobody can
 * reason about. The question asked instead is whether **any** grant they hold declares
 * `webhook: configure`, which is stable and is the capability Q58's "editor and above"
 * names.
 */
function endpointUrlVisibility(
  policy: RoutePolicy,
  resolved: ResolvedMembership,
): { endpointUrl?: "whole" | "masked" } {
  if (policy.resource !== "webhook" || policy.action !== "read") return {};
  const mayConfigure = holdsStatement(
    { memberRole: resolved.memberRole, grants: resolved.grants },
    "webhook",
    "configure",
  );
  return { endpointUrl: mayConfigure ? "whole" : "masked" };
}

/** The context an installation-only row leaves behind: the environment, and no workspace. */
async function claimContext(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
  path: string,
): Promise<{ workspaceId?: string; environment?: string }> {
  const environment = await environmentFor(deps, c, policy);
  // `PUT /admin/workspaces/{id}/shared` and the archive both name a workspace in the
  // path even though the act is the claim's, and the handler wants it.
  const named = segment(policy.path, path, "id");
  return {
    ...(named === undefined || policy.path.includes("/workspaces/{id}") === false
      ? {}
      : { workspaceId: named }),
    ...(environment === undefined ? {} : { environment }),
  };
}

/**
 * Whether the router will serve this path, on this method, past this middleware.
 *
 * `matchedRoutes` from `hono/route` is Hono's own answer: it carries every handler this
 * request matched, middleware included. So a routed path has **at least one** match whose
 * own `path` is not a middleware wildcard, and an unrouted one has only the middleware
 * that is asking. The route table is not consulted at all, which is the point - asking
 * the table whether a path is routed is how the first version came to serve a route the
 * table had never heard of (PR #1061's review).
 *
 * The helper rather than `c.req.matchedRoutes`, which Hono deprecated in favour of it.
 *
 * The fallback, when the helper answers with nothing at all, is to **refuse** every
 * `/admin/` path: one this middleware cannot classify is one nobody decided who may call,
 * which is the direction the whole table fails in. `matchedRoutes` is typed as always
 * returning an array, so that branch is a guard against a future version rather than a
 * case reachable today, and it is written as a length test for that reason.
 */
function isRoutedAdminPath(c: Parameters<MiddlewareHandler<ApiEnv>>[0], path: string): boolean {
  const matched: readonly { readonly path?: string }[] = matchedRoutes(c) ?? [];
  if (matched.length === 0) return path.startsWith("/admin/");
  return matched.some((route) => route.path !== undefined && !route.path.endsWith("*"));
}

/**
 * The admin-group registrar.
 *
 * Third in the admin bucket, after the session gate and the Q6 environment middleware:
 * an unauthenticated request should be refused by the gate rather than by the grant it
 * does not hold, and an act's environment has to be resolved before it can be authorised
 * for one.
 */
export const registerGrantCheck: SliceRegistrar = (group, deps) => {
  group.use("*", grantCheck(deps));
};
