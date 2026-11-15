import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import { makeServeLogoHandler } from "./handler.js";

export const LogoKeyParam = z.object({
  key: z.string().openapi({ param: { name: "key", in: "path" }, example: "a".repeat(64) }),
});

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

export const registerLogos: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(serveLogoRoute, makeServeLogoHandler(deps));
};
