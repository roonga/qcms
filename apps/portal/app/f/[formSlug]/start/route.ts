import { NextResponse } from "next/server";

import { ApiError, startSession } from "@/lib/server/api";
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
    return NextResponse.redirect(new URL(`/s/${session.sessionId}`, request.url), 303);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal";
    const state = ERROR_STATE[code] ?? "error";
    return NextResponse.redirect(new URL(`/f/${formSlug}?state=${state}`, request.url), 303);
  }
}
