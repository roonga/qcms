import { NextResponse } from "next/server";

import { rosterOp } from "@/lib/server/api";
import { newOperationToken } from "@/lib/server/operation-token";
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
  let body: { op?: unknown; groupId?: unknown; instanceId?: unknown; step?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  if ((body.op !== "add" && body.op !== "remove") || typeof body.groupId !== "string") {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  if (body.op === "remove" && typeof body.instanceId !== "string") {
    return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  // The client's committed step cursor (ADR-28), forwarded so the API's response
  // renders that step rather than advancing away from it.
  const stepIndex =
    typeof body.step === "number" && Number.isInteger(body.step) && body.step >= 0
      ? body.step
      : undefined;
  try {
    const next = await rosterOp(
      sessionId,
      token,
      {
        op: body.op,
        groupId: body.groupId,
        ...(typeof body.instanceId === "string" ? { instanceId: body.instanceId } : {}),
        opToken: newOperationToken(),
      },
      stepIndex,
    );
    return NextResponse.json(next);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
