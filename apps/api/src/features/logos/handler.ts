import type { RouteHandler } from "@hono/zod-openapi";
import {
  clearThemeLogoKey,
  getAppearanceLogo,
  takeDownAppearanceLogo,
  writeSiteAuditRow,
} from "@roonga/qcms-db";

import { LogoKey } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
// Type-only, so there is no runtime import cycle with route.ts.
import type { serveLogoRoute, takeDownLogoRoute } from "./route.js";

/**
 * One answer for a malformed key, a key nothing was ever stored under and a key stored in
 * another installation: a route that answered differently would say which keys exist.
 */
function notFound(): ApiError {
  return new ApiError("LOGO_NOT_FOUND", 404, "No such logo");
}

/**
 * A day, and revalidated rather than `immutable` for a year: a Site administrator may take
 * a logo down, and a cache that never asks again would keep serving it (Code Owner,
 * 2026-11-16).
 */
const CACHE_CONTROL = "public, max-age=86400, must-revalidate";

/**
 * Served off the request's own pool, where an environment role holds `SELECT` on three
 * columns of `control.appearance_logos` and nothing else, and reads exactly those three.
 * Takes no session and no grant: it reads no form, version or response. The
 * Content-Security-Policy is the app-wide one `securityHeaders()` sets.
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
        // The key is the digest of the bytes, so it is already the strong validator.
        etag: `"${logo.key}"`,
      },
    });
  };
}

/**
 * A Site administrator's act and nobody else's (Code Owner, 2026-11-16), which the route
 * policy's `installationOnly` row is what enforces. The theme keys go first, because the
 * themes' foreign key forbids a dangling one; a draft and a version carry their
 * appearance by value and keep the key they froze, which then serves the uniform 404.
 */
export function makeTakeDownLogoHandler(
  deps: Deps,
): RouteHandler<typeof takeDownLogoRoute, ApiEnv> {
  return async (c) => {
    const key = c.req.valid("param").key;
    const principal = c.get("adminPrincipal");
    if (principal === undefined) {
      throw new ApiError("ADMIN_REQUIRED", 401, "This act is attributed to an account");
    }
    if (!LogoKey.safeParse(key).success) throw notFound();

    const themesCleared = await deps.databases.control.transaction(async (tx) => {
      const cleared = await clearThemeLogoKey(tx, key);
      if (!(await takeDownAppearanceLogo(tx, key))) throw notFound();
      await writeSiteAuditRow(tx, {
        actor: principal.userId,
        subject: key,
        kind: "logo",
        detail: `logo=takedown themes=${String(cleared)}`,
        occurredAt: deps.clock.now(),
      });
      return cleared;
    });

    return c.json({ logoKey: key, themesCleared }, 200);
  };
}
