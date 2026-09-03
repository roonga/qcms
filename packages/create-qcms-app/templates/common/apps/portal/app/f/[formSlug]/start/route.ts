import { NextResponse } from "next/server";

import { ApiError, startSession } from "@/lib/server/api";
import { portalBaseUrl } from "@/lib/server/config";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { writeSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF: anonymous session start (018). The entry form POSTs here (works with or
 * without JS). The BFF creates the session, stores the returned bearer in the
 * httpOnly cookie, and redirects (303) to the flow. Typed API errors map to a
 * friendly entry state. No evaluation here (R2).
 */
const ERROR_STATE: Record<string, string> = {
  FORM_CLOSED: "closed",
  NO_PUBLISHED_VERSION: "closed",
  FORM_NOT_FOUND: "notfound",
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ formSlug: string }> },
): Promise<NextResponse> {
  const { formSlug } = await ctx.params;
  // SEC-9's CSRF belt (issue #487), before anything is created. A refusal lands on
  // the entry page's ordinary error state rather than a bare 403: the only person
  // who can ever see it is a respondent whose browser sent us here from somewhere
  // else, and a page they can read beats a blank one.
  if (!isSameOriginPost(request)) {
    return NextResponse.redirect(new URL(`/f/${formSlug}?state=error`, portalBaseUrl()), 303);
  }
  let challengeToken: string | undefined;
  try {
    const form = await request.formData();
    const value = form.get("challengeToken");
    if (typeof value === "string" && value !== "") challengeToken = value;
  } catch {
    // No form body (e.g. a bare POST): proceed without a challenge token.
  }
  try {
    const session = await startSession(
      challengeToken === undefined ? { formSlug } : { formSlug, challengeToken },
    );
    await writeSessionToken(session.sessionToken);
    return NextResponse.redirect(new URL(`/s/${session.sessionId}`, portalBaseUrl()), 303);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal";
    const state = ERROR_STATE[code] ?? "error";
    return NextResponse.redirect(new URL(`/f/${formSlug}?state=${state}`, portalBaseUrl()), 303);
  }
}
