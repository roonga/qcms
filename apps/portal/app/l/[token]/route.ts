import { NextResponse } from "next/server";

import { ApiError, startLinkSession } from "@/lib/server/api";
import { currentBasePath } from "@/lib/server/environment";
import { writeSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF: secure-link entry (018). Silent verify-and-redirect: the BFF exchanges the
 * opaque link token for a session, stores the bearer in the httpOnly cookie, and
 * redirects to the flow. Typed link failures redirect to the friendly typed-error
 * page (no retry affordance). No evaluation here (R2).
 *
 * **Served at every environment's address** (ADR-40 ruling 3, Q21, task 066): `/l/{token}`
 * on `prod` and `/<env>/l/{token}` on every other, which is how a non-prod environment is
 * reached at all. `proxy.ts` strips the prefix and names the environment on the request,
 * so this handler is one route; what the prefix decides is which API surface
 * `startLinkSession` calls, and therefore which pool the session lands in.
 *
 * **The redirects carry the prefix** ({@link currentBasePath}), so a respondent who
 * started in `test` stays in `test` for the rest of the flow. An unprefixed `/s/{id}`
 * would be `prod`'s address, and a `test` session read through it would be looked for in
 * `prod`'s schema and not found.
 *
 * `LINK_WRONG_ENVIRONMENT` - a token presented under the wrong prefix (Q21) - maps to the
 * same `invalid` screen every other unusable link reaches. Deliberately: the environment
 * is visible in the path and nowhere else (Q16), so the screen must not tell a holder
 * that their token is real somewhere else.
 */
const ERROR_KIND: Record<string, string> = {
  LINK_EXPIRED: "expired",
  LINK_CONSUMED: "consumed",
  LINK_REVOKED: "revoked",
  LINK_INVALID: "invalid",
  LINK_WRONG_ENVIRONMENT: "invalid",
  FORM_CLOSED: "closed",
  NO_PUBLISHED_VERSION: "closed",
};

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const basePath = await currentBasePath();
  try {
    const session = await startLinkSession({ token });
    await writeSessionToken(session.sessionToken);
    return NextResponse.redirect(
      new URL(`${basePath}/s/${session.sessionId}`, request.url),
      303,
    );
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal";
    const kind = ERROR_KIND[code] ?? "invalid";
    return NextResponse.redirect(new URL(`${basePath}/link-error?kind=${kind}`, request.url), 303);
  }
}
