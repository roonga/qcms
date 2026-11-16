import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { insertAppearanceLogo, isLogoTakenDown, writeAccessAuditRow } from "@roonga/qcms-db";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import type { ApiEnv } from "../../openapi.js";
import { rateLimit } from "../../rate-limit.js";
import { NothingToDerive, deriveTheme } from "./brand-fetcher/derive.js";
import { BrandFetchRefused } from "./brand-fetcher/port.js";
import type { ReencodedLogo } from "./brand-fetcher/port.js";
import { checkUrl } from "./brand-fetcher/policy.js";
import { sha256Hex } from "./logo-digest.js";
import { requireOpenWorkspace } from "./resolve.js";
import { DeriveThemeBody, DeriveThemeResponse, WorkspaceIdParam } from "./schema.js";

const fail = {
  noPrincipal: (): ApiError =>
    new ApiError(
      "ADMIN_REQUIRED",
      401,
      "This act is attributed to an account, so it needs a session",
    ),
  /** One body for every refusal from F1 to F9, whatever the reason (SEC-18 F10). */
  refused: (): ApiError =>
    new ApiError(
      "THEME_DERIVE_REFUSED",
      422,
      "That address could not be read for a theme. Check it is a public https page and try again.",
    ),
  nothingFound: (): ApiError =>
    new ApiError(
      "THEME_DERIVE_NOTHING_FOUND",
      422,
      "The page was read, but it declares no colour a theme could start from",
    ),
} as const;

export const deriveThemeRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/themes/derive",
  summary: "Derive a theme from a website (Edit forms)",
  description:
    "Behind its own flag, off by default and separate from the agent flag; with it off the " +
    "route is 404. Fetches the https page the user typed, up to two of its own stylesheets " +
    "and one PNG or JPEG logo, each held to SEC-18: every DNS record public, the connection " +
    "pinned to the checked address, port 443, one same-site redirect, a sniffed content " +
    "type and caps on bytes, time and pixels. The logo is re-encoded and stored. Nothing " +
    "is saved as a theme. A logo that is refused is left out and the derive goes on; every " +
    "other refusal is one uniform `THEME_DERIVE_REFUSED`. Each fetch writes one `derive` " +
    "row to the workspace audit, naming the host contacted, before it is contacted.",
  tags: ["workspace themes"],
  request: { params: WorkspaceIdParam, body: jsonBody(DeriveThemeBody) },
  responses: {
    200: {
      description: "Colours, a registry face and a stored logo key; no page text",
      content: { "application/json": { schema: DeriveThemeResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409, 422, 429),
  },
  ...withScopes("forms:write"),
});

async function storeDerivedLogo(
  deps: Deps,
  logo: ReencodedLogo,
  actor: string,
): Promise<string | null> {
  const key = await sha256Hex(logo.bytes);
  try {
    await insertAppearanceLogo(deps.databases.control, {
      key,
      contentType: logo.contentType,
      bytes: logo.bytes,
      actor,
    });
  } catch (err: unknown) {
    // A Site administrator took this image down: the theme is derived without it.
    if (isLogoTakenDown(err)) return null;
    throw err;
  }
  return key;
}

export function makeDeriveThemeHandler(deps: Deps): RouteHandler<typeof deriveThemeRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    await requireOpenWorkspace(deps.databases.control, workspaceId);
    const { url } = c.req.valid("json");

    let host: string;
    try {
      host = checkUrl(url, deps.config.themeDerive.allowedHosts).host;
    } catch {
      throw fail.refused();
    }
    try {
      const derived = await deriveTheme(
        {
          fetcher: deps.brandFetcher,
          codec: deps.logoCodec,
          storeLogo: (logo) => storeDerivedLogo(deps, logo, principal.userId),
          beforeContact: (contacted) =>
            writeAccessAuditRow(deps.databases.control, {
              actor: principal.userId,
              workspaceId,
              kind: "derive",
              detail: `host=${contacted}`,
              occurredAt: deps.clock.now(),
            }),
          onLogoDropped: (reason) =>
            deps.logger.info("theme derive logo dropped", { reason, host }),
        },
        url,
      );
      return c.json({ derived }, 200);
    } catch (err: unknown) {
      if (err instanceof NothingToDerive) throw fail.nothingFound();
      if (err instanceof BrandFetchRefused) {
        deps.logger.info("theme derive refused", { reason: err.reason, host });
        throw fail.refused();
      }
      throw err;
    }
  };
}

function deriveLimiter(deps: Deps, scope: "user" | "workspace") {
  const limit =
    scope === "user"
      ? deps.config.rateLimit.themeDerivePerUser
      : deps.config.rateLimit.themeDerivePerWorkspace;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs: limit.windowMs,
    max: limit.max,
    keyFor: (c) =>
      scope === "user"
        ? `rl:theme-derive:user:${(c as Context<ApiEnv>).get("adminPrincipal")?.userId ?? ""}`
        : `rl:theme-derive:workspace:${c.req.param("id") ?? ""}`,
  });
}

/** Unmounted with the flag off, so the route is the router's 404 and no policy or limiter runs (S1). */
export const registerThemeDerive: SliceRegistrar = (group, deps: Deps): void => {
  if (deps.config.flags.themeDerive !== "on") return;
  group.use("/workspaces/:id/themes/derive", deriveLimiter(deps, "user"));
  group.use("/workspaces/:id/themes/derive", deriveLimiter(deps, "workspace"));
  group.openapi(deriveThemeRoute, makeDeriveThemeHandler(deps));
};
