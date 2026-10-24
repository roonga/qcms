import { NextResponse } from "next/server";

import { ApiError, startLinkSession } from "@/lib/server/api";
import { currentBasePath } from "@/lib/server/environment";
import { writeSessionToken } from "@/lib/server/session-cookie";

// The redirects below carry the environment prefix (Q21), because an unprefixed
// `/s/{id}` is `prod`'s address and a non-prod session read there is not found.
//
// `LINK_WRONG_ENVIRONMENT` maps to the same `invalid` screen as every other unusable
// link: the screen must not tell a holder that their token is real somewhere else (Q16).
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
    return NextResponse.redirect(new URL(`${basePath}/s/${session.sessionId}`, request.url), 303);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal";
    const kind = ERROR_KIND[code] ?? "invalid";
    return NextResponse.redirect(new URL(`${basePath}/link-error?kind=${kind}`, request.url), 303);
  }
}
