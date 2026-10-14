/**
 * Route definitions for releases, promotion and the live environment set (ADR-40, task
 * 065).
 *
 * Publishing and releasing are two acts: a version is published once into `control` and
 * shared by every environment (ADR-18), and what makes it live somewhere is a **release**.
 * These are the routes for the second act, on the **admin** surface, behind the internal
 * service-token gate and the admin-auth gate like every other admin slice.
 *
 * Scopes are the forms pair rather than a new `releases:*` member of the SEC-5 taxonomy:
 * a release is an act on a form's lifecycle, and the authority that will actually gate it
 * is ADR-41's `forms.approver` role under task 070's two-person rule, not a scope. Scopes
 * stay inert at launch either way.
 *
 * **`GET /environments` rides this slice** because the Q6 switcher and the release screens
 * are one feature: the switcher offers the environments a release can name, and a second
 * slice holding one read would be a module boundary drawn around a single list.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeEnvironmentSetHandler,
  makeReleaseHistoryHandler,
  makeReleaseVersionHandler,
} from "./handler.js";
import {
  EnvironmentSetResponse,
  ReleaseHistoryQuery,
  FormIdParam,
  ReleaseHistoryResponse,
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
    "rollback and is the same act. A release never re-pins a session already open.",
  tags,
  request: { params: FormIdParam, body: jsonBody(ReleaseVersionBody) },
  responses: {
    200: {
      description: "The release record just written",
      content: { "application/json": { schema: ReleasedResponse } },
    },
    // 400: an environment this deployment does not serve. 404: no such form, or no such
    // published version of it. 409: that version is already what is released there, so
    // the release would add a row recording no change.
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
};
