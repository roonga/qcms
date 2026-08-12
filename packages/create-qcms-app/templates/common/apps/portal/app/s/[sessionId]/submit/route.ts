import { NextResponse } from "next/server";

import { submitSession } from "@/lib/server/api";
import { apiErrorResponse, writeReceiptCookie } from "@/lib/server/route-helpers";
import { clearSessionToken, readSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF proxy: submit the session (020). The client posts the (loose) submit body,
 * the BFF attaches the session bearer, forwards to the API, stores the returned
 * receipt in a short-lived httpOnly cookie for the completion page, drops the
 * session cookie, and tells the client where to go. No evaluation here (R2).
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
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
    return NextResponse.json({ ok: true, redirect: "/done" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
