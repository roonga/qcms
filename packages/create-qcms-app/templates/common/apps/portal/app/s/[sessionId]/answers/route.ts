import { NextResponse } from "next/server";

import { submitAnswer } from "@/lib/server/api";
import { apiErrorResponse, isSameOriginPost } from "@/lib/server/route-helpers";
import { readSessionToken } from "@/lib/server/session-cookie";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  // SEC-9's CSRF belt, above the credential read: a cross-site caller is refused
  // before this handler touches the session cookie.
  if (!isSameOriginPost(request)) {
    return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  }
  const token = await readSessionToken();
  if (token === undefined) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const { sessionId } = await ctx.params;
  let body: { questionId?: unknown; value?: unknown; step?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  if (typeof body.questionId !== "string") {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  // The client's committed step cursor (ADR-28), forwarded so the API's response
  // renders that step rather than advancing away from it.
  const stepIndex =
    typeof body.step === "number" && Number.isInteger(body.step) && body.step >= 0
      ? body.step
      : undefined;
  try {
    const next = await submitAnswer(sessionId, token, body.questionId, body.value, stepIndex);
    return NextResponse.json(next);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
