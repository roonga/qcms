import type { NextRequest } from "next/server";

import { agentAuthoringEnabled } from "@/lib/server/agent";
import { parseAssistConversation, parseAssistParams } from "@/lib/server/assist-request";
import { screenAssist } from "@/lib/server/forms";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/* Keep the upstream body unbuffered so SSE frames reach the panel as they arrive. */
export async function POST(request: NextRequest): Promise<Response> {
  if (!agentAuthoringEnabled()) return new Response(null, { status: 404 });
  if (!isSameOriginPost(request)) return new Response(null, { status: 403 });

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const body = (await request.json().catch(() => undefined)) as
    | {
        readonly conversation?: unknown;
        readonly screen?: unknown;
        readonly params?: unknown;
        readonly conversationId?: unknown;
        readonly visitId?: unknown;
      }
    | undefined;

  const params = parseAssistParams(body?.params);

  const upstream = await screenAssist(session, {
    conversation: parseAssistConversation(body?.conversation),
    screen: typeof body?.screen === "string" ? body.screen : "",
    ...(params === undefined ? {} : { params }),
    conversationId: typeof body?.conversationId === "string" ? body.conversationId : "",
    ...(typeof body?.visitId === "string" ? { visitId: body.visitId } : {}),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardedHeaders(upstream),
  });
}

function forwardedHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  if (upstream.ok) {
    headers.set("cache-control", "no-cache, no-store, no-transform");
    headers.set("x-accel-buffering", "no");
  }
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) headers.set("retry-after", retryAfter);
  return headers;
}
