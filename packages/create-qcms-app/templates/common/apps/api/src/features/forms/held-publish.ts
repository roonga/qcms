import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import { canonicalJson, type FormId } from "@roonga/qcms-core";
import {
  decideApprovalRequest,
  getApprovalRequest,
  getDraft,
  getDraftForUpdate,
  getForm,
  getFormEnvironmentState,
  listApprovalRequests,
  lockForm,
  type ApprovalRequestRow,
  type Executor,
  type FormDraftRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses, withScopes, type ApiEnv } from "../../openapi.js";
import { writeAgentStep, type AgentStepSite } from "../agent/audit.js";
import { PRODUCTION_ENVIRONMENT } from "../membership/policy.js";
import { decideInWorkspace } from "../membership/resolver.js";
import {
  heldRequestFailures,
  holdWorkspaceRequest,
  lapseHeldRequest,
  refuseHeldDecision,
  twoPersonRuleApplies,
  writeHeldRequestAudit,
} from "../membership/two-person.js";
import { recordRelease } from "../releases/release.js";
import {
  nonProductionEnvironments,
  readWorkflow,
  requireDraftEligible,
} from "../releases/workflow.js";
import { ApprovalRequestView, requestView } from "../site-admins/schema.js";
import { freezeDraft, requireFormId, writeVersion } from "./handler.js";

const tags = ["forms"];

export const heldPublishFailures = {
  draftChanged: (): ApiError =>
    new ApiError(
      "DRAFT_CHANGED_SINCE_REQUEST",
      409,
      "This draft has changed since publishing was requested. Request publishing again.",
    ),
  draftMoved: (): ApiError =>
    new ApiError(
      "STALE_REVIEW",
      409,
      "The review this confirmation carries is out of date: draftRevision has changed. " +
        "Nothing was written; read the review again and confirm the new one.",
      { field: "draftRevision" },
    ),
  noDraft: (): ApiError => new ApiError("NO_DRAFT", 409, "This form has no draft to publish"),
  requesterCannotPublish: (): ApiError =>
    new ApiError(
      "REQUESTER_CANNOT_PUBLISH",
      409,
      "The person who asked no longer holds Edit forms and Publish forms for prod in this " +
        "workspace, so nothing is published",
    ),
  formLeftWorkspace: (): ApiError =>
    new ApiError(
      "PUBLISH_FORM_LEFT_WORKSPACE",
      409,
      "The form is no longer in the workspace this publish was asked in, so nothing is " +
        "published and this request has ended",
    ),
  onlyProd: (): ApiError =>
    new ApiError("ENVIRONMENT_NOT_PROD", 400, "A held publish is decided under environment=prod"),
} as const;

/**
 * SHA-256 over the whole draft row but its save time, so a later save of any column,
 * appearance alone included, changes it.
 */
export async function draftContentHash(draft: FormDraftRow): Promise<string> {
  const content: Partial<FormDraftRow> = { ...draft };
  delete content.updatedAt;
  const bytes = new TextEncoder().encode(canonicalJson(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a draft publish into these destinations is held: second approval on in the
 * workspace, `prod` among them, and `prod` the only environment the site serves.
 */
export async function draftPublishIsHeld(
  deps: Deps,
  input: { readonly workspaceId: string; readonly environments: readonly string[] },
): Promise<boolean> {
  if (!input.environments.includes(PRODUCTION_ENVIRONMENT)) return false;
  if (nonProductionEnvironments(deps.databases.names).length > 0) return false;
  return twoPersonRuleApplies(deps.databases.control, {
    workspaceId: input.workspaceId,
    environment: PRODUCTION_ENVIRONMENT,
  });
}

/**
 * Hold a draft publish to `prod` as a request bound to the draft's revision and content
 * hash. Nothing is frozen. The draft must compile and the workflow must admit a draft
 * publish to `prod`, so the request is one an approver could apply.
 */
export async function holdDraftPublish(
  deps: Deps,
  input: {
    readonly formId: FormId;
    readonly workspaceId: string;
    readonly requester: string;
    readonly expectedRevision?: number;
    /** Set for a confirmed assistant step, whose row shares the hold's transaction. */
    readonly agent?: AgentStepSite | undefined;
  },
): Promise<ApprovalRequestRow> {
  requireDraftEligible(
    await readWorkflow(deps.databases.control, deps.databases.names),
    PRODUCTION_ENVIRONMENT,
  );
  const frozen = await freezeDraft(deps, input.formId);
  if (input.expectedRevision !== undefined && frozen.draftRevision !== input.expectedRevision) {
    throw heldPublishFailures.draftMoved();
  }
  return deps.databases.control.transaction(async (tx) => {
    await lockForm(tx, input.formId);
    const draft = await getDraftForUpdate(tx, input.formId);
    if (draft === undefined) throw heldPublishFailures.noDraft();
    if (draft.revision !== frozen.draftRevision) throw heldPublishFailures.draftMoved();
    const held = await holdWorkspaceRequest(tx, deps.clock.now(), {
      kind: "draft-publish",
      workspaceId: input.workspaceId,
      target: input.formId,
      requester: input.requester,
      payload: { revision: draft.revision, contentHash: await draftContentHash(draft) },
      environment: PRODUCTION_ENVIRONMENT,
      formId: input.formId,
    });
    await writeAgentStep(tx, input.agent, held.requestId, deps.clock.now());
    return held;
  });
}

/**
 * Whether the draft is still the one the request bound. `lock` holds the draft row for the
 * rest of the transaction, so a save cannot commit between this check and the publish that
 * deletes the draft.
 */
async function draftMatches(
  exec: Executor,
  formId: FormId,
  request: ApprovalRequestRow,
  options: { readonly lock?: boolean } = {},
): Promise<boolean> {
  const draft =
    options.lock === true ? await getDraftForUpdate(exec, formId) : await getDraft(exec, formId);
  if (draft === undefined) return false;
  return (
    draft.revision === request.payload.revision &&
    (await draftContentHash(draft)) === request.payload.contentHash
  );
}

async function requesterCanPublish(
  exec: Executor,
  input: { readonly userId: string; readonly workspaceId: string },
): Promise<boolean> {
  const cells = [
    { resource: "form", action: "write" },
    { resource: "form", action: "publish" },
    { resource: "release", action: "create", environment: PRODUCTION_ENVIRONMENT },
  ] as const;
  for (const request of cells) {
    const decision = await decideInWorkspace(exec, { ...input, claim: false, request });
    if (!decision.allowed) return false;
  }
  return true;
}

async function heldRequestOf(
  exec: Executor,
  formId: FormId,
  requestId: string,
): Promise<ApprovalRequestRow> {
  const request = await getApprovalRequest(exec, requestId);
  if (request === undefined || request.kind !== "draft-publish" || request.target !== formId) {
    throw heldRequestFailures.notFound();
  }
  return request;
}

async function rejectWithin(
  tx: Executor,
  deps: Deps,
  request: ApprovalRequestRow,
  deciderId: string,
  formId: FormId,
): Promise<ApprovalRequestRow> {
  const at = deps.clock.now();
  const decided = await decideApprovalRequest(tx, {
    requestId: request.requestId,
    decision: "rejected",
    decidedBy: deciderId,
    decidedAt: at,
  });
  if (decided === undefined) throw heldRequestFailures.notPending();
  await writeHeldRequestAudit(tx, {
    request: decided,
    act: "reject",
    actor: deciderId,
    at,
    environment: PRODUCTION_ENVIRONMENT,
    formId,
  });
  return decided;
}

/**
 * Freeze the draft as it was requested and make it live in `prod`, in one transaction under
 * the form's lock, the requester recorded as having frozen the version. A draft saved since
 * the request, or a form moved out of the request's workspace, freezes nothing and ends the
 * request as `lapsed`, naming the approver who tried, so the requester can ask again.
 */
export async function approveDraftPublish(
  deps: Deps,
  input: { readonly formId: FormId; readonly requestId: string; readonly approverId: string },
): Promise<ApprovalRequestRow> {
  const exec = deps.databases.control;
  const request = await heldRequestOf(exec, input.formId, input.requestId);
  refuseHeldDecision(request, input.approverId, deps.clock.now());
  const workspaceId = request.workspaceId as string;

  // Compiling a draft an unlocked read already says the request no longer binds would be
  // wasted; the locked read inside the transaction is what decides, so a save landing in
  // between ends the request rather than leaving it pending for a second attempt.
  const frozen =
    (await getForm(exec, input.formId))?.workspaceId === workspaceId &&
    (await draftMatches(exec, input.formId, request))
      ? await freezeDraft(deps, input.formId)
      : undefined;

  const applied = await exec.transaction(async (tx) => {
    const form = await lockForm(tx, input.formId);
    const current = await heldRequestOf(tx, input.formId, input.requestId);
    const at = deps.clock.now();
    refuseHeldDecision(current, input.approverId, at);
    const lapse = async (ending: ApiError): Promise<ApiError> => {
      await lapseHeldRequest(tx, {
        request: current,
        actor: input.approverId,
        at,
        environment: PRODUCTION_ENVIRONMENT,
        formId: input.formId,
      });
      return ending;
    };
    if (form?.workspaceId !== workspaceId) return lapse(heldPublishFailures.formLeftWorkspace());
    if (
      frozen === undefined ||
      frozen.draftRevision !== current.payload.revision ||
      !(await draftMatches(tx, input.formId, current, { lock: true }))
    ) {
      return lapse(heldPublishFailures.draftChanged());
    }
    if (!(await requesterCanPublish(tx, { userId: current.requestedBy, workspaceId }))) {
      throw heldPublishFailures.requesterCannotPublish();
    }
    requireDraftEligible(await readWorkflow(tx, deps.databases.names), PRODUCTION_ENVIRONMENT);

    const decided = await decideApprovalRequest(tx, {
      requestId: current.requestId,
      decision: "approved",
      decidedBy: input.approverId,
      decidedAt: at,
    });
    if (decided === undefined) throw heldRequestFailures.notPending();
    const version = await writeVersion(tx, input.formId, frozen, at, current.requestedBy);
    await recordRelease(tx, {
      formId: input.formId,
      environment: PRODUCTION_ENVIRONMENT,
      version: version.version,
      releasedBy: input.approverId,
      approvedBy: input.approverId,
      fromEnvironment: undefined,
      closed:
        (await getFormEnvironmentState(tx, input.formId, PRODUCTION_ENVIRONMENT))?.closed ?? false,
    });
    await writeHeldRequestAudit(tx, {
      request: decided,
      act: "approve",
      actor: input.approverId,
      at,
      environment: PRODUCTION_ENVIRONMENT,
      formId: input.formId,
    });
    return decided;
  });
  if (applied instanceof ApiError) throw applied;
  return applied;
}

export async function rejectDraftPublish(
  deps: Deps,
  input: { readonly formId: FormId; readonly requestId: string; readonly deciderId: string },
): Promise<ApprovalRequestRow> {
  return deps.databases.control.transaction(async (tx) => {
    await lockForm(tx, input.formId);
    const request = await heldRequestOf(tx, input.formId, input.requestId);
    refuseHeldDecision(request, input.deciderId, deps.clock.now());
    return rejectWithin(tx, deps, request, input.deciderId, input.formId);
  });
}

const HeldPublishParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
  requestId: z
    .string()
    .min(1)
    .max(100)
    .openapi({ param: { name: "requestId", in: "path" }, example: "apr_0f3c" }),
});

const ProdQuery = z.object({
  environment: z.string().openapi({ param: { name: "environment", in: "query" }, example: "prod" }),
});

const HeldPublishView = ApprovalRequestView.extend({
  draftUnchanged: z.boolean(),
});

const HeldPublishList = z
  .object({
    formId: z.string(),
    requests: z.array(HeldPublishView),
    // The draft the approver would publish, shown while it is the one a pending request bound.
    draft: z
      .object({
        revision: z.number().int(),
        definition: z.unknown(),
        appearance: z.unknown().nullable(),
      })
      .nullable(),
  })
  .openapi("HeldPublishList");

export const HeldPublishResponse = z
  .object({ request: ApprovalRequestView })
  .openapi("HeldPublish");

export const listHeldPublishesRoute = createRoute({
  method: "get",
  path: "/forms/{id}/publish-requests",
  summary: "Held publishes of this form's draft to prod (admin)",
  description:
    "On a site whose only environment is prod, with second approval on, a draft publish to " +
    "prod is held here until a different holder of Publish forms for prod approves it. " +
    "Newest first. `draft` is the draft as it now stands, given while a pending request " +
    "still binds it, so the approver sees exactly what would be published. A request an " +
    "approver could not apply carries status `lapsed`, not `rejected`, with that approver " +
    "as `decidedBy`.",
  tags,
  request: { params: HeldPublishParams.pick({ id: true }) },
  responses: {
    200: {
      description: "The held publishes",
      content: { "application/json": { schema: HeldPublishList } },
    },
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const approveHeldPublishRoute = createRoute({
  method: "post",
  path: "/forms/{id}/publish-requests/{requestId}/approve",
  summary: "Approve a held draft publish to prod (admin)",
  description:
    "By a holder of Publish forms for prod who is not the requester, under " +
    "`environment=prod`. Freezes the draft as the next version and makes it live in prod in " +
    "one act, the requester recorded as the account that froze it. Refused, and nothing " +
    "frozen, when the draft changed since the request, which also ends the request as " +
    "`lapsed` so the requester can ask again; when the requester no longer holds Edit " +
    "forms and Publish forms for prod; after 7 days.",
  tags,
  request: { params: HeldPublishParams, query: ProdQuery },
  responses: {
    200: {
      description: "Approved, frozen and live in prod",
      content: { "application/json": { schema: HeldPublishResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const rejectHeldPublishRoute = createRoute({
  method: "post",
  path: "/forms/{id}/publish-requests/{requestId}/reject",
  summary: "Reject a held draft publish to prod (admin)",
  description: "Nothing is frozen. By a holder of Publish forms for prod who is not the requester.",
  tags,
  request: { params: HeldPublishParams, query: ProdQuery },
  responses: {
    200: {
      description: "Rejected",
      content: { "application/json": { schema: HeldPublishResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

function approverOf(c: { get: (key: "adminPrincipal") => unknown }): string {
  const principal = c.get("adminPrincipal") as { readonly userId: string } | undefined;
  if (principal === undefined)
    throw new ApiError("unauthorized", 401, "Admin authentication required");
  return principal.userId;
}

export function makeListHeldPublishesHandler(
  deps: Deps,
): RouteHandler<typeof listHeldPublishesRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const exec = deps.databases.control;
    const { rows } = await listApprovalRequests(exec, {
      kinds: ["draft-publish"],
      target: formId,
      limit: 50,
    });
    const draft = await getDraft(exec, formId);
    const hash = draft === undefined ? undefined : await draftContentHash(draft);
    const requests = rows.map((row) => ({
      ...requestView(row),
      draftUnchanged:
        draft !== undefined &&
        draft.revision === row.payload.revision &&
        hash === row.payload.contentHash,
    }));
    const bound = requests.some((row) => row.status === "pending" && row.draftUnchanged);
    return c.json(
      {
        formId,
        requests,
        draft:
          bound && draft !== undefined
            ? {
                revision: draft.revision,
                definition: draft.definition,
                appearance: draft.appearance,
              }
            : null,
      },
      200,
    );
  };
}

export function makeApproveHeldPublishHandler(
  deps: Deps,
): RouteHandler<typeof approveHeldPublishRoute, ApiEnv> {
  return async (c) => {
    const { id, requestId } = c.req.valid("param");
    if (c.req.valid("query").environment !== PRODUCTION_ENVIRONMENT) {
      throw heldPublishFailures.onlyProd();
    }
    const approved = await approveDraftPublish(deps, {
      formId: requireFormId(id),
      requestId,
      approverId: approverOf(c),
    });
    return c.json({ request: requestView(approved) }, 200);
  };
}

export function makeRejectHeldPublishHandler(
  deps: Deps,
): RouteHandler<typeof rejectHeldPublishRoute, ApiEnv> {
  return async (c) => {
    const { id, requestId } = c.req.valid("param");
    if (c.req.valid("query").environment !== PRODUCTION_ENVIRONMENT) {
      throw heldPublishFailures.onlyProd();
    }
    const rejected = await rejectDraftPublish(deps, {
      formId: requireFormId(id),
      requestId,
      deciderId: approverOf(c),
    });
    return c.json({ request: requestView(rejected) }, 200);
  };
}
