import type { NextRequest } from "next/server";

import { operationalRedirect } from "@/lib/ops/moved-contexts";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/**
 * The export moved under Operations; this address still arrives.
 *
 * A 308 rather than a 302, because the method has to survive: a download is a GET, and a
 * redirect that let it become one by accident would be a different request. The query is
 * the whole of what an export address says, so it travels unparsed.
 */
export async function GET(
  request: NextRequest,
  context: { readonly params: Promise<{ formId: string }> },
): Promise<Response> {
  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const { formId } = await context.params;
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  return Response.redirect(
    new URL(operationalRedirect(formId, "export", query), request.url),
    308,
  );
}
