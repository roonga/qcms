import type { NextRequest } from "next/server";

import { exportFilename } from "@/lib/ops/export";
import { exportResponses } from "@/lib/server/responses";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/**
 * The export download (task 035; wireframe "export UI - streams the download").
 *
 * A route handler rather than a server action, because the product of this call is
 * **bytes for the browser to save**, not state for a component to render. The API
 * emits a streamed `text/csv` (UTF-8 BOM, CRLF records, RFC 4180 quoting) or
 * `application/json`; this handler forwards the request with the admin's credentials
 * and passes the body straight back.
 *
 * ## Nothing is buffered, parsed or re-encoded here
 *
 * `upstream.body` is handed to the `Response` constructor unchanged, so the export
 * streams through this process rather than being assembled in it. Two things follow,
 * and both are the point: an export larger than this process's memory still works,
 * and the answer values never exist as a value this app could log, cache or
 * serialize into a React payload (SEC-8, SEC-13). Re-encoding would also break the
 * bytes: dropping the BOM mojibakes non-ASCII answers in Excel, and normalizing CRLF
 * breaks RFC 4180 conformance.
 *
 * ## The guard, and why it is this one
 *
 * `requireAdminSessionForRequest()` returns a 303 rather than throwing a redirect, so
 * an unauthenticated GET is answered with a redirect the browser follows as a GET
 * instead of the 307 that would re-issue the request (issue #177). A layout does not
 * run for a route handler, so this call is the only gate this file has, and
 * `shell-route-guards.test.ts` enforces that it is here and that its answer is used.
 *
 * It exports GET only and changes no state, so SEC-9's same-origin POST belt does not
 * apply (rule 3 of that test).
 */
export async function GET(
  request: NextRequest,
  context: { readonly params: Promise<{ formId: string }> },
): Promise<Response> {
  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const { formId } = await context.params;
  const query = request.nextUrl.searchParams;
  const format = query.get("format") === "json" ? "json" : "csv";
  const version = query.get("version");
  const from = query.get("from");
  const to = query.get("to");

  const upstream = await exportResponses(session, formId, {
    format,
    ...(version === null || version === "" ? {} : { version }),
    ...(from === null || from === "" ? {} : { from }),
    ...(to === null || to === "" ? {} : { to }),
  });

  // A refusal is JSON and small; let it through as-is so the browser shows the API's
  // own error rather than downloading a file containing one.
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: contentHeaders(upstream),
    });
  }

  const headers = contentHeaders(upstream);
  // Named here rather than upstream: the API streams a body and does not know what an
  // operator's downloads folder should call it. It comes from `exportFilename`, the same
  // function the dialog's link is built from, so the name the operator was promised and
  // the name the browser saves are one rule with one unit test.
  headers.set(
    "content-disposition",
    `attachment; filename="${exportFilename(formId, { format, version: version ?? "", from: "", to: "" })}"`,
  );
  return new Response(upstream.body, { status: 200, headers });
}

/** Carry the upstream's content typing through untouched; add nothing else. */
function contentHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength !== null) headers.set("content-length", contentLength);
  return headers;
}
