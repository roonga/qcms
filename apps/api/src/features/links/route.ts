/**
 * Route definitions for the secure-link admin slices (task 024).
 *
 * Every route is declared with `@hono/zod-openapi` `createRoute` (017's
 * convention) and carries its SEC-5 scope intent via `withScopes` — `links:mint`
 * for all of them (inert at launch; annotated so `/api/v1` activation is wiring,
 * not archaeology). The admin group is guarded by the internal service-token
 * gate (SEC-4) and the admin-auth gate (`registerAdminAuth`) before any handler
 * runs; in a public-only process the group is not mounted, so these paths 404,
 * never 403 (ADR-09).
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import { makeListLinksHandler, makeMintLinksHandler, makeRevokeLinkHandler } from "./handler.js";
import {
  FormIdParam,
  LinkIdParam,
  LinkListResponse,
  MintLinksBody,
  MintLinksResponse,
  RevokedLinkResponse,
} from "./schema.js";

const tags = ["links"];

export const mintLinksRoute = createRoute({
  method: "post",
  path: "/forms/{id}/links",
  summary: "Mint one or a batch of secure links for a form (admin)",
  tags,
  request: {
    params: FormIdParam,
    body: { required: true, content: { "application/json": { schema: MintLinksBody } } },
  },
  responses: {
    201: {
      description: "The minted links, each with its shareable URL and expiry",
      content: { "application/json": { schema: MintLinksResponse } },
    },
    // 400: malformed form id / non-future expiry. 404: no such form.
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("links:mint"),
});

export const listLinksRoute = createRoute({
  method: "get",
  path: "/forms/{id}/links",
  summary: "List a form's secure links with lifecycle state (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description: "The minted links with derived state (active/consumed/expired/revoked)",
      content: { "application/json": { schema: LinkListResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("links:mint"),
});

export const revokeLinkRoute = createRoute({
  method: "post",
  path: "/links/{linkId}/revoke",
  summary: "Revoke a secure link; start-session rejects it thereafter (admin)",
  tags,
  request: { params: LinkIdParam },
  responses: {
    200: {
      description: "The revoked link",
      content: { "application/json": { schema: RevokedLinkResponse } },
    },
    // 404: no such link (or already revoked).
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("links:mint"),
});

/**
 * Register every secure-link route on an admin group. The admin-auth gate
 * (`registerAdminAuth`) must precede this in the admin bucket so it runs first.
 */
export const registerLinks: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(mintLinksRoute, makeMintLinksHandler(deps));
  group.openapi(listLinksRoute, makeListLinksHandler(deps));
  group.openapi(revokeLinkRoute, makeRevokeLinkHandler(deps));
};
