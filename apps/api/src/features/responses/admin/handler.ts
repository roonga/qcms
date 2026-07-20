/**
 * Response listing / export / erasure admin handlers (task 023; ARCHITECTURE
 * §4.3). The launch-scope **data-out** surface: transaction scripts (R5) over the
 * reporting view and `@qcms/db` helpers.
 *
 * Erasure safety (SEC / ADR-17). Every read path - list, detail, and export -
 * goes through `reporting.responses`, whose tombstone anti-join excludes erased
 * (and non-submitted) sessions **by construction**. `getResponse` returns
 * `undefined` for an erased session, so detail 404s; the export stream pages the
 * same view, so an erased response can never leak. No handler here reads the raw
 * `submissions`/`answers` tables for content bypassing the view (unflag touches
 * `submissions` only to release a flag, never to render answers outward).
 *
 * Fetch-pure (R4): time is `deps.clock`, streams are the web `ReadableStream` and
 * `TextEncoder` (no `node:*`), so the export never buffers the whole table - it
 * pulls bounded keyset pages. Answer **values are never logged** (SEC-8).
 *
 * **issue #5 launder.** `@qcms/db`'s `sessions` row (enum `access_mode`, branded
 * ids) resolves to a TypeScript *error* type through the package's emitted
 * `.d.ts`; reading it through a narrow local view with a single cast on an
 * *unannotated* const keeps this slice typed - the same pattern as the other
 * response slices. The reporting helpers already return clean, explicit row
 * types, so their rows need no launder.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  type FormDefinition,
  type FormId,
  parseFormId,
  parseSessionId,
  type SessionId,
} from "@qcms/core";
import {
  answerLedger,
  clearSubmissionFlag,
  enqueue,
  eraseSession,
  fetchResponsePage,
  getFormVersion,
  getResponse,
  getSession,
  getSubmission,
  listResponses,
  listTombstones,
  type ReportingResponseRow,
  SessionNotFoundError,
} from "@qcms/db";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { csvDataRow, csvHeaderRow, questionIdsInDocumentOrder, UTF8_BOM } from "./csv.js";
import type {
  eraseRoute,
  exportRoute,
  getResponseRoute,
  listErasuresRoute,
  listResponsesRoute,
  unflagRoute,
} from "./route.js";

/** The outbox event released when a withheld (flagged) response is unflagged (020). */
const RESPONSE_SUBMITTED = "response.submitted" as const;

/** Keyset page size for export streaming - bounds the export's working set. */
const EXPORT_PAGE_SIZE = 500;

/** Default and maximum list page sizes. */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// --- issue #5 laundered view (sessions row only) ----------------------------

interface SessionView {
  readonly sessionId: SessionId;
  readonly formId: FormId;
  readonly formVersion: number;
}
interface LedgerRowView {
  readonly questionId: string;
  readonly value: unknown;
  readonly answeredAt: Date;
}

// --- typed failures ---------------------------------------------------------

const fail = {
  invalidFormId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  invalidSessionId: (): ApiError => new ApiError("INVALID_SESSION_ID", 400, "Malformed session id"),
  invalidQuery: (message: string): ApiError => new ApiError("INVALID_QUERY", 400, message),
  responseNotFound: (): ApiError =>
    new ApiError("RESPONSE_NOT_FOUND", 404, "No such response for this form"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
  sessionNotFound: (): ApiError => new ApiError("SESSION_NOT_FOUND", 404, "No such session"),
  submissionNotFound: (): ApiError =>
    new ApiError("SUBMISSION_NOT_FOUND", 404, "No submission for this session"),
} as const;

// --- shared parse helpers ---------------------------------------------------

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidFormId();
  return parsed.value;
}

function requireSessionId(id: string): SessionId {
  const parsed = parseSessionId(id);
  if (!parsed.ok) throw fail.invalidSessionId();
  return parsed.value;
}

/** Parse a `version` query value to a positive integer, or 400. */
function parseVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw fail.invalidQuery("version must be a positive integer");
  return n;
}

/** Parse an ISO date-time query value to a Date, or 400. */
function parseDate(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw fail.invalidQuery(`${field} must be an ISO date-time`);
  return d;
}

/** Resolve `page`/`pageSize` query values to a clamped limit/offset window. */
function pageWindow(
  page: string | undefined,
  pageSize: string | undefined,
): { page: number; pageSize: number; limit: number; offset: number } {
  const p = page === undefined ? 1 : Number(page);
  const size = pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(pageSize);
  if (!Number.isInteger(p) || p < 1) throw fail.invalidQuery("page must be a positive integer");
  if (!Number.isInteger(size) || size < 1) {
    throw fail.invalidQuery("pageSize must be a positive integer");
  }
  const clamped = Math.min(size, MAX_PAGE_SIZE);
  return { page: p, pageSize: clamped, limit: clamped, offset: (p - 1) * clamped };
}

/** The optional version/date filter shared by list and export, parsed from query. */
function parseFilter(q: {
  version?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): { version?: number; from?: Date; to?: Date } {
  return {
    ...(q.version !== undefined ? { version: parseVersion(q.version) } : {}),
    ...(q.from !== undefined ? { from: parseDate(q.from, "from") } : {}),
    ...(q.to !== undefined ? { to: parseDate(q.to, "to") } : {}),
  };
}

// --- GET /admin/forms/:id/responses -----------------------------------------

export function makeListResponsesHandler(
  deps: Deps,
): RouteHandler<typeof listResponsesRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const q = c.req.valid("query");
    const filter = parseFilter(q);
    const { page, pageSize, limit, offset } = pageWindow(q.page, q.pageSize);

    const { rows, total } = await listResponses(deps.db, {
      formId,
      ...filter,
      ...(q.flagged !== undefined ? { flagged: q.flagged === "true" } : {}),
      limit,
      offset,
    });

    return c.json(
      {
        responses: rows.map((r) => ({
          sessionId: r.sessionId,
          formVersion: r.formVersion,
          submittedAt: r.submittedAt.toISOString(),
          accessMode: r.accessMode,
          flaggedReason: r.flaggedReason,
          answers: r.answers,
        })),
        page,
        pageSize,
        total,
      },
      200,
    );
  };
}

// --- GET /admin/forms/:id/responses/:sessionId ------------------------------

export function makeGetResponseHandler(deps: Deps): RouteHandler<typeof getResponseRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);

    // Reads the reporting view: an erased session is absent (tombstone anti-join)
    // → undefined → 404. Detail cannot bypass the exclusion.
    const detail = await getResponse(deps.db, formId, sessionId);
    if (detail === undefined) throw fail.responseNotFound();

    // The append-only answer ledger - the audit history (every revision, oldest
    // first). Present because the session is non-erased (erasure deletes it).
    // Laundered: `answers` rows carry branded ids that read as an error type
    // through @qcms/db's emitted `.d.ts` (issue #5); a single cast on an
    // unannotated const keeps this typed.
    const ledger = (await answerLedger(deps.db, sessionId)) as LedgerRowView[];

    return c.json(
      {
        sessionId: detail.sessionId,
        formId: detail.formId,
        formVersion: detail.formVersion,
        submittedAt: detail.submittedAt.toISOString(),
        accessMode: detail.accessMode,
        flaggedReason: detail.flaggedReason,
        contentHash: detail.contentHash,
        answers: detail.answers,
        ledger: ledger.map((entry) => ({
          questionId: entry.questionId,
          value: entry.value,
          answeredAt: entry.answeredAt.toISOString(),
        })),
      },
      200,
    );
  };
}

// --- GET /admin/forms/:id/export --------------------------------------------

export function makeExportHandler(deps: Deps): RouteHandler<typeof exportRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const q = c.req.valid("query");
    const format = q.format ?? "csv";
    const filter = parseFilter(q);

    if (format === "json") {
      // JSON may span versions (no version filter required).
      const stream = jsonExportStream(deps, { formId, ...filter });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${formId}-responses.json"`,
        },
      });
    }

    // CSV columns depend on the version's shape, so a version is required and
    // must resolve to a published version.
    if (filter.version === undefined) {
      throw fail.invalidQuery("version is required for CSV export");
    }
    const version = filter.version;
    const formVersion = await getFormVersion(deps.db, formId, version);
    if (formVersion === undefined) throw fail.versionNotFound();
    const columns = questionIdsInDocumentOrder(formVersion.definition satisfies FormDefinition);

    const stream = csvExportStream(
      deps,
      { formId, version, from: filter.from, to: filter.to },
      columns,
    );
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${formId}-v${String(version)}-responses.csv"`,
      },
    });
  };
}

/** Filter shape the export streams page over. */
interface ExportFilter {
  formId: FormId;
  version?: number | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

/**
 * A memory-bounded CSV stream: emit the BOM + header once, then keyset-page the
 * reporting view, encoding one CRLF record per row. Only `EXPORT_PAGE_SIZE` rows
 * are ever held in memory, so the export is O(page), not O(table).
 */
function csvExportStream(
  deps: Deps,
  filter: ExportFilter,
  columns: readonly string[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let after: SessionId | undefined;
  let started = false;
  let done = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      if (!started) {
        controller.enqueue(encoder.encode(UTF8_BOM + csvHeaderRow(columns)));
        started = true;
        return;
      }
      const rows = await nextPage(deps, filter, after);
      if (rows.length === 0) {
        controller.close();
        done = true;
        return;
      }
      let chunk = "";
      for (const row of rows) chunk += csvDataRow(row, columns);
      controller.enqueue(encoder.encode(chunk));
      after = lastSessionId(rows);
      if (rows.length < EXPORT_PAGE_SIZE) {
        controller.close();
        done = true;
      }
    },
  });
}

/**
 * A memory-bounded JSON array stream: emit `[`, then reporting rows keyset-paged
 * and comma-separated, then `]`. Same bounded working set as CSV.
 */
function jsonExportStream(deps: Deps, filter: ExportFilter): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let after: SessionId | undefined;
  let started = false;
  let first = true;
  let done = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      if (!started) {
        controller.enqueue(encoder.encode("["));
        started = true;
        return;
      }
      const rows = await nextPage(deps, filter, after);
      if (rows.length === 0) {
        controller.enqueue(encoder.encode("]"));
        controller.close();
        done = true;
        return;
      }
      let chunk = "";
      for (const row of rows) {
        chunk += (first ? "" : ",") + JSON.stringify(jsonRow(row));
        first = false;
      }
      controller.enqueue(encoder.encode(chunk));
      after = lastSessionId(rows);
      if (rows.length < EXPORT_PAGE_SIZE) {
        controller.enqueue(encoder.encode("]"));
        controller.close();
        done = true;
      }
    },
  });
}

/** One keyset page of reporting rows for an export. */
function nextPage(
  deps: Deps,
  filter: ExportFilter,
  after: SessionId | undefined,
): Promise<ReportingResponseRow[]> {
  return fetchResponsePage(deps.db, {
    formId: filter.formId,
    ...(filter.version !== undefined ? { version: filter.version } : {}),
    ...(filter.from !== undefined ? { from: filter.from } : {}),
    ...(filter.to !== undefined ? { to: filter.to } : {}),
    ...(after !== undefined ? { afterSessionId: after } : {}),
    limit: EXPORT_PAGE_SIZE,
  });
}

/** The last (highest) session id in a keyset page - the next page's cursor. */
function lastSessionId(rows: ReportingResponseRow[]): SessionId {
  return rows[rows.length - 1]!.sessionId;
}

/** The reporting row shape for JSON export (canonical encodings as-is). */
function jsonRow(row: ReportingResponseRow): Record<string, unknown> {
  return {
    sessionId: row.sessionId,
    formId: row.formId,
    formVersion: row.formVersion,
    submittedAt: row.submittedAt.toISOString(),
    accessMode: row.accessMode,
    answers: row.answers,
  };
}

// --- POST /admin/sessions/:sessionId/erase ----------------------------------

export function makeEraseHandler(deps: Deps): RouteHandler<typeof eraseRoute, ApiEnv> {
  return async (c) => {
    const sessionId = requireSessionId(c.req.valid("param").sessionId);
    const { reason } = c.req.valid("json");

    try {
      // eraseSession is idempotent (returns the existing tombstone with
      // alreadyErased:true) and owns its own transaction (016).
      const outcome = await eraseSession(deps.db, sessionId, reason);
      return c.json(
        {
          sessionId: outcome.sessionId,
          formId: outcome.formId,
          formVersion: outcome.formVersion,
          erasedAt: outcome.erasedAt.toISOString(),
          reason: outcome.reason,
          alreadyErased: outcome.alreadyErased,
        },
        200,
      );
    } catch (err: unknown) {
      if (err instanceof SessionNotFoundError) throw fail.sessionNotFound();
      throw err;
    }
  };
}

// --- GET /admin/erasures ----------------------------------------------------

export function makeListErasuresHandler(
  deps: Deps,
): RouteHandler<typeof listErasuresRoute, ApiEnv> {
  return async (c) => {
    const q = c.req.valid("query");
    const formId = q.formId === undefined ? undefined : requireFormId(q.formId);
    const { limit, offset } = pageWindow(q.page, q.pageSize);

    const rows = await listTombstones(deps.db, {
      ...(formId !== undefined ? { formId } : {}),
      limit,
      offset,
    });

    return c.json(
      {
        erasures: rows.map((t) => ({
          sessionId: t.sessionId,
          formId: t.formId,
          formVersion: t.formVersion,
          erasedAt: t.erasedAt.toISOString(),
          reason: t.reason,
        })),
      },
      200,
    );
  };
}

// --- POST /admin/responses/:sessionId/unflag --------------------------------

export function makeUnflagHandler(deps: Deps): RouteHandler<typeof unflagRoute, ApiEnv> {
  return async (c) => {
    const sessionId = requireSessionId(c.req.valid("param").sessionId);

    // The submission carries the audit payload (contentHash, locked answers) the
    // withheld event needs; a session without one has nothing to release → 404.
    const submission = await getSubmission(deps.db, sessionId);
    if (submission === undefined) throw fail.submissionNotFound();

    const session = (await getSession(deps.db, sessionId)) as SessionView | undefined;
    if (session === undefined) throw fail.sessionNotFound();

    // One transaction: the conditional flag-clear and the released event commit
    // together (transactional outbox, §11). `clearSubmissionFlag` is race-safe -
    // only the caller that actually flips the flag gets `true`, so the event is
    // enqueued exactly once even under concurrent unflags (idempotent).
    const released = await deps.db.transaction(async (tx) => {
      const flipped = await clearSubmissionFlag(tx, sessionId);
      if (flipped) {
        await enqueue(tx, {
          eventType: RESPONSE_SUBMITTED,
          payload: {
            sessionId,
            formId: session.formId,
            formVersion: session.formVersion,
            submittedAt: submission.submittedAt.toISOString(),
            contentHash: submission.contentHash,
            // Locked (hidden-excluded, I6) answers - never the raw ledger.
            answers: submission.lockedAnswers.answers,
          },
        });
      }
      return flipped;
    });

    return c.json({ sessionId, released }, 200);
  };
}
