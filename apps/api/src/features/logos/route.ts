import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import { makeServeLogoHandler, makeTakeDownLogoHandler } from "./handler.js";

export const LogoKeyParam = z.object({
  key: z.string().openapi({ param: { name: "key", in: "path" }, example: "a".repeat(64) }),
});

export const LogoTakedownResponse = z
  .object({
    logoKey: z.string().openapi({ example: "a".repeat(64) }),
    /** Themes whose `logoKey` named these bytes and now name none. */
    themesCleared: z.number().int().nonnegative().openapi({ example: 1 }),
  })
  .openapi("LogoTakedownResponse");

export const serveLogoRoute = createRoute({
  method: "get",
  path: "/logos/{key}",
  summary: "Serve a stored raster logo by its content key (no session)",
  description:
    "Answers an unauthenticated respondent through the portal, which serves the bytes " +
    "from its own origin so SEC-9's `img-src 'self'` holds. The key is the SHA-256 of the " +
    "bytes, so the content is immutable and the address unguessable. Only a PNG, JPEG or " +
    "WebP already in the immutable logo store is served, with the type it was sniffed as " +
    "at upload and `X-Content-Type-Options: nosniff`. Anything else, a malformed key " +
    "included, is the same 404: the route is no oracle for which keys exist.",
  tags: ["responses"],
  request: { params: LogoKeyParam },
  responses: {
    // No body schema: a content-typed response would not permit the raw bytes.
    200: { description: "The logo bytes, with their stored content type" },
    ...errorResponses(404),
  },
  ...withScopes("responses:read"),
});

export const takeDownLogoRoute = createRoute({
  method: "delete",
  path: "/logos/{key}",
  summary: "Take a stored logo down (Site administrator)",
  description:
    "Site administrator only, and no workspace grant reaches it: the bytes are stored " +
    "site-wide and a takedown removes them for every workspace at once. The key is " +
    "cleared off every theme that named it and the bytes are deleted, so a draft, a " +
    "version or a theme still holding the key is served the same 404 an unknown key is. " +
    "One `logo` row goes to the site audit. The act is not reversible: re-uploading the " +
    "same image stores it again under the same key.",
  tags: ["workspaces"],
  request: { params: LogoKeyParam },
  responses: {
    200: {
      description: "The key that is gone, and how many themes stopped naming it",
      content: { "application/json": { schema: LogoTakedownResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:write"),
});

export const registerLogos: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(serveLogoRoute, makeServeLogoHandler(deps));
};

/** The admin half, mounted on the admin surface alone. */
export const registerLogoTakedown: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(takeDownLogoRoute, makeTakeDownLogoHandler(deps));
};
