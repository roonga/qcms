import type { NextRequest } from "next/server";

import type { ExportFilterField } from "@/lib/ops/export";
import { exportFilename, parseExportFilters } from "@/lib/ops/export";
import { exportResponses } from "@/lib/server/responses";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/**
 * The export download (task 035; screen contract "export UI - streams the download").
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
 *
 * ## The filters are validated here, not merely relayed (issue 551)
 *
 * `version`, `from` and `to` used to be forwarded exactly as they arrived, which was
 * the response browser's behaviour before issue 521 replaced it with a validated parse.
 * They now go through `parseExportFilters`, which reads the browser's own validators,
 * so the two surfaces agree about what a filter on responses is. A parameter that names
 * no filter refuses the export rather than being dropped from it: an export renders no
 * notice, and a file wider than the range its requester asked for is a false claim that
 * outlives the request. The reasoning is written out at `parseExportFilters`.
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

  const parsed = parseExportFilters(query);
  if (!parsed.ok) return invalidFilters(parsed.invalid);

  const upstream = await exportResponses(session, formId, { format, ...parsed.filters });

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
    `attachment; filename="${exportFilename(formId, { format, version: parsed.filters.version ?? "", from: "", to: "" })}"`,
  );
  return new Response(upstream.body, { status: 200, headers });
}

/**
 * The refusal for a filter this route will not apply.
 *
 * Shaped as the API's own error envelope (`{ error: { code, message, details } }`) and
 * given the code the API raises for the same complaint, because this handler's other
 * failure path is the upstream's refusal passed through untouched: an operator reading
 * a rejected export should not have to tell two error formats apart to learn which
 * parameter to fix. `details.invalid` names them so a caller can act on it, and no
 * `content-disposition` is set, so the browser shows the message instead of saving a
 * file whose contents are an error.
 *
 * ## It says what it wants, which is what makes the narrowing safe
 *
 * A bare refusal would be the one real cost of tightening `from`/`to` to whole days:
 * someone whose hand-written or scripted URL stops working, with no way to see why
 * short of reading this source. So the message names each rejected parameter and the
 * shape it expects, including the instant spelling, because a caller sending
 * `to=2026-07-31T12:00:00.000Z` needs to know that instants are accepted at a day's
 * edges rather than rejected outright. That turns a breaking change into a
 * self-correcting one.
 *
 * ## Why this string is not in the message table (ADR-27)
 *
 * ADR-27 is about user-facing strings in a rendered surface, and this route has none:
 * it emits bytes. Its sibling failure path is the API's own English envelope passed
 * through untouched, no route handler in this app reads `lib/i18n`, and translating
 * only this one refusal would leave the two errors an operator can receive from this
 * URL in two different languages. Matching the path that already exists is the smaller
 * inconsistency; a rendered surface for export errors would be the thing to localize.
 */
function invalidFilters(invalid: readonly ExportFilterField[]): Response {
  const body = {
    error: {
      code: "INVALID_QUERY",
      message: `Nothing was exported. ${invalid.map(expectedShape).join(" ")}`,
      details: { invalid },
    },
  };
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** What one rejected parameter should have looked like, in the caller's own terms. */
function expectedShape(field: ExportFilterField): string {
  if (field === "version") return "version must be a positive whole number.";
  const edge =
    field === "from"
      ? "the instant it begins (YYYY-MM-DDT00:00:00.000Z)"
      : "the instant it ends (YYYY-MM-DDT23:59:59.999Z)";
  return `${field} must be a whole UTC day (YYYY-MM-DD), or ${edge}.`;
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
