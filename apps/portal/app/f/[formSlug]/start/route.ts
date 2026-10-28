import { NextResponse } from "next/server";

import { ApiError, startAnonymousSession } from "@/lib/server/api";
import { portalBaseUrl } from "@/lib/server/config";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { writeSessionToken } from "@/lib/server/session-cookie";

// `prod`'s route alone (SEC-14): `proxy.ts` serves `/f` under no environment prefix and
// on no hostname reserved for one, so the redirects below need no prefix.
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
  // SEC-9's CSRF belt, before anything is created. The refusal lands on the entry
  // page's error state rather than a bare 403 so a misdirected respondent can read it.
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
