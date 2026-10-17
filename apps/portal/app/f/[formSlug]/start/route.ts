import { NextResponse } from "next/server";

import { ApiError, startAnonymousSession } from "@/lib/server/api";
import { portalBaseUrl } from "@/lib/server/config";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { writeSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF: anonymous session start (018). The entry form POSTs here (works with or
 * without JS). The BFF creates the session, stores the returned bearer in the
 * httpOnly cookie, and redirects (303) to the flow. Typed API errors map to a
 * friendly entry state. No evaluation here (R2).
 *
 * **`prod`'s route and `prod`'s alone** (SEC-14, task 066). `proxy.ts` does not serve the
 * `/f` segment under an environment prefix, nor on a hostname reserved for a non-prod
 * environment, so every address that reaches this handler is a production one and its
 * redirects carry no prefix. The API would refuse it anyway: the form-slug door is not
 * mounted on a non-prod respondent surface, so the answer there is a 404 and not a 403
 * (ADR-09, criterion 3).
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
    const session = await startAnonymousSession(
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
