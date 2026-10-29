import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeEnvironmentSetHandler,
  makeReleaseBatchHandler,
  makeReleaseBatchLookupHandler,
  makeReleaseHistoryHandler,
  makeReleaseReviewHandler,
  makeReleaseVersionHandler,
  makeReleaseWorkflowReadHandler,
  makeReleaseWorkflowWriteHandler,
} from "./handler.js";
import {
  EnvironmentSetResponse,
  IdempotencyKeyParam,
  ReleaseBatchBody,
  ReleaseBatchResponse,
  ReleaseHistoryQuery,
  FormIdParam,
  ReleaseHistoryResponse,
  ReleaseReviewBody,
  ReleaseReviewResponse,
  ReleaseVersionBody,
  ReleaseWorkflowBody,
  ReleaseWorkflowResponse,
  ReleasedResponse,
} from "./schema.js";

const tags = ["releases"];

export const releaseVersionRoute = createRoute({
  method: "post",
  path: "/forms/{id}/releases",
  summary: "Release a published version to an environment, or promote it there (admin)",
  description:
    "Writes one release record and copies nothing: the form id and the version number " +
    "are the published ones. Releasing an earlier version than the one it replaces is a " +
    "rollback and is the same act. A release never re-pins a session already open. " +
    "When test and prod are served, production requires prior test or prod release history; " +
    "otherwise the request is refused with TEST_RELEASE_REQUIRED.",
  tags,
  request: { params: FormIdParam, body: jsonBody(ReleaseVersionBody) },
  responses: {
    200: {
      description: "The release record just written",
      content: { "application/json": { schema: ReleasedResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const releaseHistoryRoute = createRoute({
  method: "get",
  path: "/forms/{id}/releases",
  summary: "The release history of a form: who released what, when, and from where (admin)",
  tags,
  request: { params: FormIdParam, query: ReleaseHistoryQuery },
  responses: {
    200: {
      description: "Every release of this form, newest first, each rollback marked",
      content: { "application/json": { schema: ReleaseHistoryResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("forms:read"),
});

export const releaseReviewRoute = createRoute({
  method: "post",
  path: "/forms/{id}/release-review",
  summary: "What releasing a draft or a version into each permitted target would do (admin)",
  description:
    "A read, and it writes nothing: no version, no release, no review token and no " +
    "access-audit row. It reports one target per environment the caller holds " +
    "`release: create` in and no others, with what is serving there, whether intake is " +
    "closed, the committed release rows that satisfy the target's prerequisite, the " +
    "blockers that remain, and whether the two-person rule applies and would refuse this " +
    "account as the version's author. Until a release-workflow revision is configured " +
    "the review reports `workflowSource: default`, which is this deployment's derived " +
    "test and prod behaviour, and a missing production prerequisite keeps the " +
    "TEST_RELEASE_REQUIRED code. A version with a prior release in the target itself is " +
    "a rollback and is eligible there regardless of prerequisites; the two-person rule " +
    "still applies to it. The review is a report rather than a reservation: the " +
    "confirmation rechecks every expectation in its own transaction.",
  tags,
  request: { params: FormIdParam, body: jsonBody(ReleaseReviewBody) },
  responses: {
    200: {
      description: "The source, the workflow revision and one entry per permitted target",
      content: { "application/json": { schema: ReleaseReviewResponse } },
    },
    // 404: no such form, no such published version, or no open draft to review.
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const environmentSetRoute = createRoute({
  method: "get",
  path: "/environments",
  summary: "The live environment set, in canonical order (admin)",
  description:
    "The set the Q6 switcher offers and a release may name. Read from the environments " +
    "table, which is the source of the set; the per-environment settings on those rows " +
    "are not exposed here.",
  tags,
  request: {},
  responses: {
    200: {
      description: "The environments this deployment serves",
      content: { "application/json": { schema: EnvironmentSetResponse } },
    },
    ...errorResponses(401),
  },
  ...withScopes("forms:read"),
});

export const releaseBatchRoute = createRoute({
  method: "post",
  path: "/forms/{id}/release-batch",
  summary: "Release one published version into every named destination, atomically (admin)",
  description:
    "One confirmation, one transaction. **Every destination is authorised on its own**: " +
    "the gate evaluates `release: create` once per listed environment and refuses on the " +
    "first failure, naming only that environment, so a request naming `test` and `prod` " +
    "cannot reach `prod` on a `test` grant. At commit the workflow revision, each " +
    "destination's newest release-state sequence, the prerequisite evidence and the " +
    "two-person rule are all rechecked, and any refusal rolls back the whole act: a " +
    "denied second destination leaves no release row and no queued event for the first. " +
    "`idempotencyKey` is scoped to the calling account and this form; the same key with " +
    "the same intent replays the stored result with `replayed: true`, and the same key " +
    "with a different intent is refused with 422. Only successes are stored, so a " +
    "refusal leaves the key free to retry. `expectedSequence` is `null` for a " +
    "destination with no release history, and covers intake as well as the version " +
    "because a close and a reopen each append a row.",
  tags,
  request: { params: FormIdParam, body: jsonBody(ReleaseBatchBody) },
  responses: {
    200: {
      description: "The released version and one record per destination",
      content: { "application/json": { schema: ReleaseBatchResponse } },
    },
    // 409: STALE_REVIEW, ALREADY_RELEASED, RELEASE_RACED, APPROVER_UNKNOWN_AUTHOR, a
    // prerequisite or a destination the workflow keeps out of a batch.
    // 422: the same key for a different intent.
    ...errorResponses(400, 401, 403, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const releaseBatchLookupRoute = createRoute({
  method: "get",
  path: "/forms/{id}/release-batches/{key}",
  summary: "The recorded result of one confirmation, by its idempotency key (admin)",
  description:
    "For a client that lost its answer. A 404 means the confirmation did not commit, so " +
    "the same key may be resent; it does not mean the result has gone. The key is scoped " +
    "to the calling account, so another account cannot read a result it did not create, " +
    "and the release history remains the long-term answer.",
  tags,
  request: { params: IdempotencyKeyParam },
  responses: {
    200: {
      description: "The stored result of that confirmation",
      content: { "application/json": { schema: ReleaseBatchResponse } },
    },
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const releaseWorkflowReadRoute = createRoute({
  method: "get",
  path: "/release-workflow",
  summary: "The release-workflow rules in force, per destination (admin)",
  description:
    "Read by every authoring role, because a publisher needs the rule the confirmation " +
    "will apply. With no revision written it reports `source: \"default\"` and the " +
    "deployment's derived behaviour, which is what runs until an installation " +
    "administrator writes one. `protected` is true for the production environment alone " +
    "and is read-only: it reports the role split and the workspace second-approver " +
    "switch, which this configuration cannot alter whatever its rules say.",
  tags,
  request: {},
  responses: {
    200: {
      description: "The revision, its source and one entry per served environment",
      content: { "application/json": { schema: ReleaseWorkflowResponse } },
    },
    ...errorResponses(401, 403),
  },
  ...withScopes("forms:read"),
});

export const releaseWorkflowWriteRoute = createRoute({
  method: "put",
  path: "/release-workflow",
  summary: "Write the next release-workflow revision (installation administrator)",
  description:
    "Installation-wide and the installation administrator's alone: a workspace's own " +
    "grants do not reach it. The write appends a revision rather than editing one, so a " +
    "release refused under an earlier revision stays explainable. Every environment " +
    "named must be served, no destination may require a prior release in itself " +
    "(releasing a version it already served is a rollback and is eligible anyway), and " +
    "the prerequisite graph must be acyclic. It creates, renames and deletes no " +
    "environment: that stays the operator command's. `expectedRevision` is `null` while " +
    "none is configured. Each write lands as an access-audit `setting` row.",
  tags,
  request: { body: jsonBody(ReleaseWorkflowBody) },
  responses: {
    200: {
      description: "The configuration as the read route reports it, at the new revision",
      content: { "application/json": { schema: ReleaseWorkflowResponse } },
    },
    // 409: another account wrote a revision first.
    ...errorResponses(400, 401, 403, 409),
  },
  ...withScopes("forms:write"),
});

export const registerReleases: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(environmentSetRoute, makeEnvironmentSetHandler(deps));
  group.openapi(releaseWorkflowReadRoute, makeReleaseWorkflowReadHandler(deps));
  group.openapi(releaseWorkflowWriteRoute, makeReleaseWorkflowWriteHandler(deps));
  group.openapi(releaseHistoryRoute, makeReleaseHistoryHandler(deps));
  group.openapi(releaseVersionRoute, makeReleaseVersionHandler(deps));
  group.openapi(releaseReviewRoute, makeReleaseReviewHandler(deps));
  group.openapi(releaseBatchRoute, makeReleaseBatchHandler(deps));
  group.openapi(releaseBatchLookupRoute, makeReleaseBatchLookupHandler(deps));
};
