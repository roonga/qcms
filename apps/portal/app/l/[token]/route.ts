import { NextResponse } from "next/server";

import { ApiError, startSession } from "@/lib/server/api";
import { writeSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF: secure-link entry (018). Silent verify-and-redirect: the BFF exchanges the
 * opaque link token for a session, stores the bearer in the httpOnly cookie, and
 * redirects to the flow. Typed link failures redirect to the friendly typed-error
 * page (no retry affordance). No evaluation here (R2).
 */
const ERROR_KIND: Record<string, string> = {
  LINK_EXPIRED: "expired",
  LINK_CONSUMED: "consumed",
  LINK_REVOKED: "revoked",
  LINK_INVALID: "invalid",
  FORM_CLOSED: "closed",
  NO_PUBLISHED_VERSION: "closed",
};

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  try {
    const session = await startSession({ token });
    await writeSessionToken(session.sessionToken);
    return NextResponse.redirect(new URL(`/s/${session.sessionId}`, request.url), 303);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal";
    const kind = ERROR_KIND[code] ?? "invalid";
    return NextResponse.redirect(new URL(`/link-error?kind=${kind}`, request.url), 303);
  }
}
