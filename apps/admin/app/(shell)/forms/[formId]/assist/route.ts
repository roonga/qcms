import type { NextRequest } from "next/server";

import { agentAuthoringEnabled } from "@/lib/server/agent";
import { parseAssistConversation, parseAssistParams } from "@/lib/server/assist-request";
import { assist } from "@/lib/server/forms";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/* Layouts do not guard route handlers. Check the flag before authentication to keep disabled assist routes
   undiscoverable. */
export async function POST(
  request: NextRequest,
  context: { readonly params: Promise<{ formId: string }> },
): Promise<Response> {
  if (!agentAuthoringEnabled()) return new Response(null, { status: 404 });
  if (!isSameOriginPost(request)) return new Response(null, { status: 403 });

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const { formId } = await context.params;
  const body = (await request.json().catch(() => undefined)) as
    | {
        readonly conversation?: unknown;
        readonly clientState?: unknown;
        readonly screen?: unknown;
        readonly params?: unknown;
        readonly conversationId?: unknown;
      }
    | undefined;

  const params = parseAssistParams(body?.params);

  const upstream = await assist(session, formId, {
    conversation: parseAssistConversation(body?.conversation),
    ...(typeof body?.clientState === "string" ? { clientState: body.clientState } : {}),
    ...(typeof body?.screen === "string" ? { screen: body.screen } : {}),
    ...(params === undefined ? {} : { params }),
    ...(typeof body?.conversationId === "string" ? { conversationId: body.conversationId } : {}),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardedHeaders(upstream),
  });
}

/* Disable proxy buffering and transformation so SSE frames remain progressive; turns must not be cached. */
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
