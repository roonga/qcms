import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import { makeListLinksHandler, makeMintLinksHandler, makeRevokeLinkHandler } from "./handler.js";
import {
  FormIdParam,
  FormLinkParams,
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
    body: jsonBody(MintLinksBody),
  },
  responses: {
    201: {
      description: "The minted links, each with its shareable URL and expiry",
      content: { "application/json": { schema: MintLinksResponse } },
    },
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
  path: "/forms/{id}/links/{linkId}/revoke",
  summary: "Revoke a secure link; start-session rejects it thereafter (admin)",
  tags,
  request: { params: FormLinkParams },
  responses: {
    200: {
      description: "The revoked link",
      content: { "application/json": { schema: RevokedLinkResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("links:mint"),
});

// `registerAdminAuth` must be registered on the admin bucket before this, so the auth
// gate runs ahead of these handlers.
export const registerLinks: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(mintLinksRoute, makeMintLinksHandler(deps));
  group.openapi(listLinksRoute, makeListLinksHandler(deps));
  group.openapi(revokeLinkRoute, makeRevokeLinkHandler(deps));
};
