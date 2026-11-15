import type { RouteHandler } from "@hono/zod-openapi";
import { getAppearanceLogo } from "@roonga/qcms-db";

import { LogoKey } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
// Type-only, so there is no runtime import cycle with route.ts.
import type { serveLogoRoute } from "./route.js";

/**
 * One answer for a malformed key, a key nothing was ever stored under and a key stored in
 * another installation: a route that answered differently would say which keys exist.
 */
function notFound(): ApiError {
  return new ApiError("LOGO_NOT_FOUND", 404, "No such logo");
}

/**
 * Content-addressed and immutable, so it may be cached for a year: the key is the digest
 * of the bytes, and nothing can ever be stored under it but those bytes.
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Served off the request's own pool, where an environment role holds `SELECT` on three
 * columns of `control.appearance_logos` and nothing else, and reads exactly those three.
 * Takes no session and no grant: it reads no form, version or response.
 */
export function makeServeLogoHandler(deps: Deps): RouteHandler<typeof serveLogoRoute, ApiEnv> {
  return async (c) => {
    const key = c.req.valid("param").key;
    if (!LogoKey.safeParse(key).success) throw notFound();

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const logo = await getAppearanceLogo(request.exec, key);
    if (logo === undefined) throw notFound();

    return new Response(new Uint8Array(logo.bytes), {
      status: 200,
      headers: {
        // The type the bytes were sniffed as at upload, never a caller's claim.
        "content-type": logo.contentType,
        "x-content-type-options": "nosniff",
        "cache-control": CACHE_CONTROL,
        // Defence in depth: nothing in an image needs to load or run anything.
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  };
}
