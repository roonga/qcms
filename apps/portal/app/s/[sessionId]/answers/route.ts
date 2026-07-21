import { NextResponse } from "next/server";

import { submitAnswer } from "@/lib/server/api";
import { apiErrorResponse } from "@/lib/server/route-helpers";
import { readSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF proxy: submit one answer (019's per-answer model). The client hydration
 * posts `{ questionId, value }` here on change/blur; the BFF attaches the session
 * bearer from the httpOnly cookie and forwards to the internal API, then returns
 * the API's re-evaluated step + flow projection verbatim so the client can
 * re-render branching. No evaluation happens in the BFF (R2).
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
  let body: { questionId?: unknown; value?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  if (typeof body.questionId !== "string") {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  try {
    const next = await submitAnswer(sessionId, token, body.questionId, body.value);
    return NextResponse.json(next);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
