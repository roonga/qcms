import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeEnvironmentSetHandler,
  makeReleaseHistoryHandler,
  makeReleaseReviewHandler,
  makeReleaseVersionHandler,
} from "./handler.js";
import {
  EnvironmentSetResponse,
  ReleaseHistoryQuery,
  FormIdParam,
  ReleaseHistoryResponse,
  ReleaseReviewBody,
  ReleaseReviewResponse,
  ReleaseVersionBody,
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

export const registerReleases: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(environmentSetRoute, makeEnvironmentSetHandler(deps));
  group.openapi(releaseHistoryRoute, makeReleaseHistoryHandler(deps));
  group.openapi(releaseVersionRoute, makeReleaseVersionHandler(deps));
  group.openapi(releaseReviewRoute, makeReleaseReviewHandler(deps));
};
