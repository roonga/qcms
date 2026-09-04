import type { NextRequest } from "next/server";

import { agentAuthoringEnabled } from "@/lib/server/agent";
import { assist } from "@/lib/server/forms";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/**
 * The assist turn's streaming proxy (task 041; work order
 * `docs/features/041-agent-form-building.md`).
 *
 * `POST /admin/forms/:id/draft/assist` answers `text/event-stream`, and this handler
 * does with it exactly what `export/route.ts` does with a CSV or JSON download:
 * forwards the request with the admin's credentials and hands the upstream body back
 * **unbuffered**. Buffering an SSE turn to re-emit it would turn a stream a panel
 * reads progressively into a wait for the whole turn to finish - the entire point of
 * `text/event-stream` is that the working indicator and the streamed prose land as
 * they arrive, not after the agent's last tool call.
 *
 * ## The flag gate is the first thing this handler does, and answers a bare 404
 *
 * `QCMS_FLAG_AGENT_AUTHORING=none` (the default) means task 041's whole surface is
 * absent, not merely hidden: no chat UI, and - here - no reachable route either. A
 * 404 with no body is what "this route does not exist" looks like from the outside,
 * which is the property exit criterion 1 asks for: flag off means no chat UI and no
 * assist routes mounted. Nothing past this line runs when the flag is off, so an
 * unauthenticated probe of this path learns nothing about whether a session, a form,
 * or a provider key exists.
 *
 * ## Guards, in the order issue #177 and SEC-9 ask for
 *
 * A route handler under `(shell)` is reached directly by the browser - the layout's
 * `requireAdminSession()` never runs for it - so this handler carries its own session
 * gate, and `shell-route-guards.test.ts` enforces that it is here and that the
 * `Response` it returns is used. It is a `POST`, so SEC-9's origin belt applies too,
 * checked in this handler's own body per that same test's rule 3.
 *
 * ## Non-200 upstream statuses are relayed, not swallowed
 *
 * A 429 (rate limited, `retry-after`), a 409 (`DRAFT_STALE`, the draft moved under the
 * conversation), a 404 or a 401 all arrive as ordinary JSON envelopes rather than an
 * event stream, and the panel renders each as its own state (rate-limited, with the
 * retry-after; stale draft). Relaying the status and body as-is, the
 * same shape `export/route.ts` uses for its own refusal path, is what lets the panel
 * tell them apart without this BFF deciding anything about what they mean (R2).
 */
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
    { readonly conversation?: unknown; readonly clientState?: unknown } | undefined;

  const upstream = await assist(session, formId, {
    conversation: parseConversation(body?.conversation),
    ...(typeof body?.clientState === "string" ? { clientState: body.clientState } : {}),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardedHeaders(upstream),
  });
}

/** Every turn whose shape this route trusts enough to forward; anything else is dropped. */
function parseConversation(
  raw: unknown,
): readonly { readonly role: "user" | "assistant"; readonly content: string }[] {
  if (!Array.isArray(raw)) return [];
  const turns: { readonly role: "user" | "assistant"; readonly content: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      turns.push({ role, content });
    }
  }
  return turns;
}

/**
 * The headers to answer with: the upstream's own `content-type` and `retry-after`
 * (a 429's caller-facing signal) carried through, and `cache-control: no-store` added
 * on a 200 - an assist turn is never a document worth caching, streamed or not.
 */
function forwardedHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  if (upstream.ok) headers.set("cache-control", "no-store");
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) headers.set("retry-after", retryAfter);
  return headers;
}
