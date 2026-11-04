import type { NextRequest } from "next/server";

import type { ExportFilterField } from "@/lib/ops/export";
import { exportExtension, exportFilename, parseExportFilters } from "@/lib/ops/export";
import { headerEnvironment } from "@/lib/environment";
import { requestEnvironment } from "@/lib/server/api";
import { exportResponses } from "@/lib/server/responses";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/* Forward export bytes unbuffered: answers must not enter React payloads or logs, and BOM/CRLF bytes must
   survive. */
export async function GET(
  request: NextRequest,
  context: { readonly params: Promise<{ formId: string }> },
): Promise<Response> {
  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const { formId } = await context.params;
  const query = request.nextUrl.searchParams;
  const format = query.get("format") === "json" ? "json" : "csv";
  // Projection is not a narrowing filter; an invalid value can safely use the API default.
  const shape = query.get("shape") === "wide" ? "wide" : "long";

  const parsed = parseExportFilters(query);
  if (!parsed.ok) return invalidFilters(parsed.invalid);

  const upstream = await exportResponses(session, formId, { format, shape, ...parsed.filters });

  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: contentHeaders(upstream),
    });
  }

  const headers = contentHeaders(upstream);
  // Choose the extension from the response: long CSV exports with repeating groups arrive as ZIP archives.
  headers.set(
    "content-disposition",
    `attachment; filename="${exportFilename(
      formId,
      headerEnvironment(await requestEnvironment(session)),
      { format, shape, version: parsed.filters.version ?? "", from: "", to: "" },
      exportExtension(format, upstream.headers.get("content-type")),
    )}"`,
  );
  return new Response(upstream.body, { status: 200, headers });
}

/* Match the upstream error envelope and language; no rendered surface exists here to localize separately. */
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

function expectedShape(field: ExportFilterField): string {
  if (field === "version") return "version must be a positive whole number.";
  const edge =
    field === "from"
      ? "the instant it begins (YYYY-MM-DDT00:00:00.000Z)"
      : "the instant it ends (YYYY-MM-DDT23:59:59.999Z)";
  return `${field} must be a whole UTC day (YYYY-MM-DD), or ${edge}.`;
}

function contentHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength !== null) headers.set("content-length", contentLength);
  return headers;
}
