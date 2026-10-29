// Mounted after the admin-session gate and environment middleware, ahead of every admin
// slice: a route with no policy row is refused (SEC-3, ADR-41).

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
import { decideAccess, holdsStatement, isEnvironmentScoped } from "./policy.js";
import {
  type ResolvedMembership,
  holdsInstallationClaim,
  resolveCallerWorkspaces,
  resolveGrants,
  workspacesAllowing,
} from "./resolver.js";
import type { GrantContext } from "./context.js";
import { GRANT_EXEMPT_ROUTES, type RoutePolicy, policyForRequest } from "./route-policy.js";

const fail = {
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
  environmentMissing: (): ApiError =>
    new ApiError(
      "INVALID_REQUEST",
      400,
      "This route acts in the environment its body names, so the body has to name one.",
    ),
  // No default: the operations context is an explicit choice, and a remembered switcher
  // header would authorise a caller for an environment they did not pick.
  environmentInQueryMissing: (): ApiError =>
    new ApiError(
      "INVALID_REQUEST",
      400,
      "This route acts in the environment its `environment` query parameter names, so the " +
        "request has to name one. There is no default: the operations context is an " +
        "explicit choice.",
    ),
  // Refused rather than ignored: such a route declares no `environment`, so a body
  // carrying one is a caller seeking authorisation against an environment other than the
  // one the handler will act in.
  noTargets: (): ApiError =>
    new ApiError(
      "INVALID_REQUEST",
      400,
      "This route acts in the environments its `targets` names, so the request has to " +
        "name at least one. Every destination is authorised on its own.",
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

function segment(template: string, path: string, name: string): string | undefined {
  const want = template.split("/");
  const got = path.split("/");
  const index = want.indexOf(`{${name}}`);
  return index === -1 ? undefined : got[index];
}

// Calls the create handler's own resolver rather than reimplementing it, so the request
// is authorised against exactly the workspace it will be written into.
async function workspaceFromBody(deps: Deps, body: unknown): Promise<string> {
  const named = (body as { workspaceId?: unknown } | undefined)?.workspaceId;
  return resolveWorkspaceForNewObject(
    deps.databases.control,
    typeof named === "string" && named !== "" ? named : undefined,
  );
}

// Hono caches the parsed body, so the validator later reads the same copy.
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

// The source is per row, never "body, else switcher": the environment the policy checks
// must be exactly the one the handler acts in. Reading an undeclared body key would let a
// caller be authorised against `test` while the handler acts on `prod`.
async function environmentFor(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
): Promise<string | undefined> {
  if (policy.namesEnvironment !== true) return undefined;

  // Resolved through the same fallback the handler's own pool selection uses.
  const switcher = deps.databases.forRequest(c.get("requestEnvironment")).environment;
  const named = (await readBody(c)) as { environment?: unknown } | undefined;
  const inBody = typeof named?.environment === "string" ? named.environment : undefined;

  if (policy.environmentFrom === "query") {
    if (inBody !== undefined) throw fail.environmentNotInBody();
    const inQuery = new URL(c.req.url).searchParams.get("environment");
    if (inQuery === null || inQuery === "") throw fail.environmentInQueryMissing();
    return inQuery;
  }

  // Handled by `targetsFor`, which evaluates the cell once per destination.
  if (policy.environmentFrom === "targets") return undefined;

  if (policy.environmentFrom === "body") {
    // Falling back to the switcher here would authorise against an environment the
    // handler will not use.
    if (inBody === undefined || inBody === "") throw fail.environmentMissing();
    return inBody;
  }

  if (inBody !== undefined) throw fail.environmentNotInBody();
  return switcher;
}

/**
 * The destinations a batch names, in the order the body lists them. An absent or
 * malformed `targets` yields an empty list, which the handler's own validator reports;
 * what matters here is that no environment is invented for it.
 */
async function targetsFor(
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
): Promise<string[]> {
  if (policy.environmentFrom !== "targets") return [];
  const body = (await readBody(c)) as { targets?: unknown } | undefined;
  // A body naming an environment of its own would be a caller seeking authorisation
  // against one the handler will not act in.
  if (typeof (body as { environment?: unknown } | undefined)?.environment === "string") {
    throw fail.environmentNotInBody();
  }
  if (!Array.isArray(body?.targets)) return [];
  return body.targets
    .map((target) => (target as { environment?: unknown } | undefined)?.environment)
    .filter((environment): environment is string => typeof environment === "string");
}

// `defer` means the path segment is not a well-formed id, so there is nothing to
// authorise and the handler answers.
type WorkspaceResolution =
  | { readonly kind: "workspace"; readonly id: string }
  | { readonly kind: "none" }
  | { readonly kind: "defer" };

// A malformed id defers to the handler, whose status differs per route. Safe: a string
// that cannot name a form names none, and handlers parse the id before using it.
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

export function grantCheck(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const principal = c.get("adminPrincipal");
    // Unreachable in the mounted order, but a refusal rather than an assertion because
    // the order is `registrars.ts`'s and not visible from here.
    if (principal === undefined) throw fail.noPrincipal();

    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    if (GRANT_EXEMPT_ROUTES.includes(`${method} ${path}`)) {
      await next();
      return;
    }

    const policy = policyForRequest(method, path);
    if (policy === undefined) {
      // A path the API serves nowhere should 404 from the router, not 403 from here. The
      // router is asked, never the policy table, which would be circular.
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

// `undefined` means defer: nothing to authorise, so the handler raises its slice's own
// refusal. Every other outcome is a context or a thrown refusal.
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

  // No role reaches these, so a caller holding every grant in the installation is still
  // refused.
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

  // A library list: the answer is a filter rather than a yes, and the handler narrows its
  // read to the resolved set.
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

  if (policy.environmentFrom === "targets") {
    return decideOverTargets(deps, {
      policy,
      path,
      userId: input.userId,
      claim,
      workspaceId: where.id,
      request,
      targets: await targetsFor(c, policy),
    });
  }

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
 * One cell per destination, refusing on the first failure and naming that environment
 * alone, so a request naming two destinations cannot reach the second on a grant covering
 * only the first. The row's environment-agnostic half, where it has one, is evaluated once.
 */
async function decideOverTargets(
  deps: Deps,
  input: {
    readonly policy: RoutePolicy;
    readonly path: string;
    readonly userId: string;
    readonly claim: boolean;
    readonly workspaceId: string;
    readonly request: AccessRequest;
    readonly targets: readonly string[];
  },
): Promise<GrantContext> {
  const { policy, workspaceId, request, targets } = input;
  const resolved: ResolvedMembership = await resolveGrants(deps.databases.control, {
    userId: input.userId,
    workspaceId,
    claim: input.claim,
  });
  const decide = (scoped: AccessRequest): void => {
    const decision = decideAccess({
      memberRole: resolved.memberRole,
      grants: resolved.grants,
      request: scoped,
    });
    if (!decision.allowed) throw fail.refused(decision.reason ?? "Refused");
  };

  const primaryScoped = isEnvironmentScoped(policy.resource, policy.action);
  // A row whose only cell is environment-scoped authorises nothing with no destination
  // named, so an empty list is a refusal rather than a pass to the validator.
  if (primaryScoped && targets.length === 0) throw fail.noTargets();
  if (!primaryScoped) decide({ resource: policy.resource, action: policy.action });

  const cells = [
    ...(primaryScoped ? [{ resource: policy.resource, action: policy.action }] : []),
    ...(policy.also === undefined ? [] : [policy.also]),
  ];
  for (const environment of targets) {
    for (const cell of cells) {
      decide({ resource: cell.resource, action: cell.action, environment });
    }
  }

  return { policy, workspaceId, environments: [...targets] };
}

/**
 * Admit a caller holding any one of an `anyOf` row's cells as a statement, carrying the
 * resolved memberships so the handler can narrow per form. Neither scope is judged here,
 * so a caller holding nothing in the requested environment gets an empty page.
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

  // Both cells are evaluated before any handler runs, against the same workspace and
  // environment, so neither half can be skipped.
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

// Asks whether any grant declares `webhook: configure` rather than reading
// `decision.role`: that field is whichever grant allowed the read first, so masking would
// vary with database row order.
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

async function claimContext(
  deps: Deps,
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  policy: RoutePolicy,
  path: string,
): Promise<{ workspaceId?: string; environment?: string }> {
  const environment = await environmentFor(deps, c, policy);
  // Some claim-only routes still name a workspace in the path, and the handler wants it.
  const named = segment(policy.path, path, "id");
  return {
    ...(named === undefined || policy.path.includes("/workspaces/{id}") === false
      ? {}
      : { workspaceId: named }),
    ...(environment === undefined ? {} : { environment }),
  };
}

// `matchedRoutes` carries every handler this request matched, middleware included, so a
// routed path has at least one match that is not a middleware wildcard. The policy table
// is deliberately not consulted.
function isRoutedAdminPath(c: Parameters<MiddlewareHandler<ApiEnv>>[0], path: string): boolean {
  const matched: readonly { readonly path?: string }[] = matchedRoutes(c) ?? [];
  // An unclassifiable `/admin/` path is treated as decided by nobody, so refused.
  if (matched.length === 0) return path.startsWith("/admin/");
  return matched.some((route) => route.path !== undefined && !route.path.endsWith("*"));
}

// Must be third in the admin bucket: the session gate refuses an unauthenticated request
// first, and the environment middleware resolves the environment an act is authorised for.
export const registerGrantCheck: SliceRegistrar = (group, deps) => {
  group.use("*", grantCheck(deps));
};
