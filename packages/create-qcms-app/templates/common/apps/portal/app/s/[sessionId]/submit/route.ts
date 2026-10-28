import { NextResponse } from "next/server";

import { submitSession } from "@/lib/server/api";
import { currentBasePath } from "@/lib/server/environment";
import { apiErrorResponse, isSameOriginPost, writeReceiptCookie } from "@/lib/server/route-helpers";
import { clearSessionToken, readSessionToken } from "@/lib/server/session-cookie";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  // SEC-9's CSRF belt, above the credential read: a cross-site caller must not reach
  // even the session cookie.
  if (!isSameOriginPost(request)) {
    return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  }
  const token = await readSessionToken();
  if (token === undefined) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const { sessionId } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed !== null && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // A body-less submit is legitimate; keep the empty object.
  }
  try {
    const receipt = await submitSession(sessionId, token, body);
    await writeReceiptCookie(receipt);
    await clearSessionToken();
    // Prefixed: the browser follows this itself, so an unprefixed path would move a
    // non-prod respondent onto `prod`'s surface (Q21).
    return NextResponse.json({ ok: true, redirect: `${await currentBasePath()}/done` });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
