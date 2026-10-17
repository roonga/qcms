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

import { getForm, getQuestion, listActiveWorkspaces } from "@roonga/qcms-db";
import type { MiddlewareHandler } from "hono";

import { parseFormId, parseQuestionId } from "@roonga/qcms-core";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { GrantContext } from "./context.js";
import type { AccessRequest } from "./policy.js";
import { decideAccess } from "./policy.js";
import {
  type ResolvedMembership,
  holdsInstallationClaim,
  resolveCallerWorkspaces,
  resolveGrants,
  workspacesAllowing,
} from "./resolver.js";
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
  malformed: (what: string): ApiError =>
    new ApiError(`INVALID_${what.toUpperCase()}_ID`, 400, `Malformed ${what} id`),
  noPrincipal: (): ApiError => new ApiError("unauthorized", 401, "Admin authentication required"),
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
 * The same three outcomes task 068's `resolveWorkspaceForNewObject` gives a create - that
 * workspace, the only one, or a refusal naming the candidates - because this runs in
 * front of the handler that then calls it, and two different answers to one question
 * would be a request authorised against one workspace and written into another.
 */
async function workspaceFromBody(deps: Deps, body: unknown): Promise<string> {
  const named = (body as { workspaceId?: unknown } | undefined)?.workspaceId;
  if (typeof named === "string" && named !== "") return named;
  const candidates = await listActiveWorkspaces(deps.databases.control);
  const only = candidates[0];
  if (only === undefined || candidates.length > 1) {
    // The handler raises the legible refusal, with the candidates in it. Authorising the
    // request against a workspace nobody named is the failure this avoids, so the act is
    // refused here and the handler's own 400 or 409 is what the caller reads.
    throw new ApiError(
      "WORKSPACE_REQUIRED",
      400,
      candidates.length > 1
        ? "More than one workspace exists, so the owning workspace has to be named"
        : "This installation has no workspace to author in",
    );
  }
  return only.id;
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

/** The environment an act names, from the body where the route carries it, else the switcher. */
async function environmentFor(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
): Promise<string | undefined> {
  if (policy.namesEnvironment !== true) return undefined;
  const body = await readBody(c);
  const named = (body as { environment?: unknown } | undefined)?.environment;
  if (typeof named === "string" && named !== "") return named;
  // The Q6 switcher's value, resolved through the same fallback the handler's own pool
  // selection uses, so the environment an act is authorised for is the environment it is
  // performed in. Until task 066 that fallback is the interim `prod` of Q53, which means
  // a close, a mint and an endpoint change are production acts today - and the matrix
  // gives a production act to a `forms.approver`.
  return deps.databases.forRequest(c.get("requestEnvironment")).environment;
}

/** The workspace a row's act is in, or `undefined` for an installation-wide row. */
async function workspaceFor(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
  path: string,
): Promise<string | undefined> {
  switch (policy.workspace) {
    case "installation":
    case "caller":
      return undefined;
    case "path": {
      const id = segment(policy.path, path, "id");
      if (id === undefined || id === "") throw fail.noWorkspace();
      return id;
    }
    case "body":
      return workspaceFromBody(deps, await readBody(c));
    case "form": {
      const raw = segment(policy.path, path, "id");
      const parsed = parseFormId(raw ?? "");
      if (!parsed.ok) throw fail.malformed("form");
      const form = await getForm(deps.databases.control, parsed.value);
      if (form === undefined) throw fail.notFound("form");
      return form.workspaceId;
    }
    case "question": {
      const raw = segment(policy.path, path, "id");
      const parsed = parseQuestionId(raw ?? "");
      if (!parsed.ok) throw fail.malformed("question");
      const question = await getQuestion(deps.databases.control, parsed.value);
      if (question === undefined) throw fail.notFound("question");
      return question.workspaceId;
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
    const route = `${method} ${path}`;

    // The capability endpoint: everybody reads their own grants (Q35), so a grant check
    // in front of it would be a check on the thing it exists to tell you. Matched on the
    // concrete path because it takes no parameters.
    if (GRANT_EXEMPT_ROUTES.includes(route)) {
      await next();
      return;
    }

    const policy = policyForRequest(method, path);
    if (policy === undefined) {
      // Not every unmatched path is an undecided route: a path the API does not serve at
      // all should 404 from the router rather than 403 from here. `app.ts` mounts this
      // group's routes after this middleware, so the only way to tell them apart is to
      // let the router answer - which it does, because an unrouted path never reaches a
      // handler. So the refusal is raised only for a path the router will serve.
      if (!isMountedAdminPath(path)) {
        await next();
        return;
      }
      throw fail.undecided(method, path);
    }

    const claim = holdsInstallationClaim(principal.role);
    if (policy.installationOnly === true) {
      if (!claim) throw fail.claimOnly();
      c.set("grantContext", { policy, ...(await claimContext(deps, c, policy, path)) });
      await next();
      return;
    }

    const environment = await environmentFor(deps, c, policy);
    const request: AccessRequest = {
      resource: policy.resource,
      action: policy.action,
      ...(environment === undefined ? {} : { environment }),
    };

    if (policy.workspace === "caller") {
      const resolved = await resolveCallerWorkspaces(deps.databases.control, {
        userId: principal.userId,
        claim,
      });
      const workspaceIds = workspacesAllowing(resolved, request);
      if (workspaceIds.length === 0) {
        throw fail.refused(
          decideAccess({ memberRole: undefined, grants: [], request }).reason ?? "Refused",
        );
      }
      c.set("grantContext", {
        policy,
        workspaceIds,
        ...(environment === undefined ? {} : { environment }),
      });
      await next();
      return;
    }

    const workspaceId = await workspaceFor(deps, c, policy, path);
    if (workspaceId === undefined) throw fail.noWorkspace();

    // The form scope's value, for the data family. The form is the `{id}` segment, and
    // the row that names a form is always a form-addressed route.
    const formId = policy.namesForm === true ? segment(policy.path, path, "id") : undefined;
    const scoped: AccessRequest = {
      ...request,
      ...(formId === undefined ? {} : { formId }),
    };

    const resolved: ResolvedMembership = await resolveGrants(deps.databases.control, {
      userId: principal.userId,
      workspaceId,
      claim,
    });
    const decision = decideAccess({
      memberRole: resolved.memberRole,
      grants: resolved.grants,
      request: scoped,
    });
    if (!decision.allowed) throw fail.refused(decision.reason ?? "Refused");

    c.set("grantContext", {
      policy,
      workspaceId,
      ...(environment === undefined ? {} : { environment }),
      ...(decision.role === undefined ? {} : { role: decision.role }),
    });
    await next();
  };
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
 * Whether the router will serve this path at all.
 *
 * Derived from the route table's own templates: every admin path the API serves has a row
 * (`route-policy.test.ts` asserts it against the shipped document), so a path matching no
 * template on **any** method is a path the router will 404. The distinction matters
 * because a 403 on a path that does not exist is an answer about authorisation to a
 * question about routing.
 */
function isMountedAdminPath(path: string): boolean {
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].some(
    (method) => policyForRequest(method, path) !== undefined,
  );
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
