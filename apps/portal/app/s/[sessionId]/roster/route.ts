import { NextResponse } from "next/server";

import { rosterOp } from "@/lib/server/api";
import { newOperationToken } from "@/lib/server/operation-token";
import { apiErrorResponse, isSameOriginPost } from "@/lib/server/route-helpers";
import { readSessionToken } from "@/lib/server/session-cookie";

/**
 * BFF proxy: the **scripted** path's Add or Remove of a repeating-group instance
 * (task 073, ADR-42, ADR-43).
 *
 * The hydrated flow posts `{op, groupId, instanceId?}` here, the BFF attaches the
 * session bearer from the httpOnly cookie, and the API's re-evaluated step projection
 * comes back verbatim so the client can re-render the group with its new roster. No
 * evaluation happens in the BFF (R2): whether the group may grow, whether the instance
 * is live and which instances the renderer should draw are all the API's answers.
 *
 * **It writes no answer**, exactly as the no-JS path's Server Action writes none: the
 * scripted path has already committed each answer at its own ADR-31 commit moment, so
 * an Add or Remove has nothing to carry.
 *
 * ## The operation token is minted here, not by the client
 *
 * The token exists to make a **replayed** post a no-op, and a replay is a property of
 * the no-JS path: its 200 re-render can be resubmitted by a reload or by Back. Nothing
 * replays a `fetch()`, so this path has no replay to refuse - but the API requires the
 * token on every roster write, because one endpoint with one rule is better than two.
 * Minting it server-side keeps it out of the client bundle entirely and makes every
 * press its own operation, which is what the scripted path means: two presses of Add
 * are two instances.
 *
 * ## Why this is a sixth belted route
 *
 * It is a state-changing POST from a browser, so SEC-9's origin belt applies exactly as
 * it does to the other five, and `scripts/check-origin-guards.test.ts` derives the set
 * from disk so this route had to be belted or the gate would name it. **The no-JS path's
 * Server Action is belted too** (Code Owner, 2026-10-01, ruling R-B2): it is a different
 * mechanism, so it reaches the same decision through `isSameOriginAction`, which wraps an
 * action's `headers()` back into the shape the belt reads. The two paths therefore share
 * one implementation of the decision, the classification and the refusal line; what
 * differs is only the refusal a respondent sees, a 403 here and a re-rendered step with a
 * message there. Next's own action check stands behind the belt rather than instead of it,
 * and it is why the portal serves `Referrer-Policy: same-origin` (SEC-9 as amended,
 * 2026-10-01): under `no-referrer` a navigation POST serializes its `Origin` as the
 * literal `null`, which Next refuses before the action runs.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  // SEC-9's CSRF belt (issue #487), above the credential read: a cross-site caller is
  // refused before this handler touches the session cookie at all.
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
