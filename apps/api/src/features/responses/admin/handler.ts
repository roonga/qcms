/**
 * Response listing / export / erasure admin handlers (task 023; ARCHITECTURE
 * §4.3). The launch-scope **data-out** surface: transaction scripts (R5) over the
 * reporting view and `@roonga/qcms-db` helpers.
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
 * Row types come straight from `@roonga/qcms-db`: the enum-bearing `sessions` row is
 * now hand-authored and sound across the package boundary (issue #5), and the
 * enum-free `answers` ledger row was always sound (branded ids on `text`
 * columns do not degrade). Both are consumed directly with no local view or
 * cast, alongside the reporting helpers' explicit row types.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  type FormDefinition,
  type FormId,
  parseFormId,
  parseSessionId,
  type SessionId,
} from "@roonga/qcms-core";
import {
  answerLedger,
  clearSubmissionFlag,
  enqueue,
  eraseSession,
  fetchResponsePage,
  getFormVersion,
  getResponse,
  getSessionInForm,
  getSubmission,
  listResponses,
  listTombstones,
  type ReportingResponseRow,
  SessionNotFoundError,
} from "@roonga/qcms-db";
import { zipStream, type ZipEntry } from "@roonga/qcms-csv";

import type { Databases } from "../../../environments.js";
import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import {
  csvDataRow,
  csvHeaderRow,
  groupDataRows,
  groupFileColumns,
  groupFileName,
  groupHeaderRow,
  LONG_SHAPE,
  responseColumns,
  RESPONSES_FILE_NAME,
  UTF8_BOM,
  type ExportShape,
  type GroupFileColumns,
  type ResponseColumn,
} from "./csv.js";
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

/**
 * The largest value a version filter can take: `form_versions.version` is an
 * `int4` column, so nothing above this can name a stored row (issue #645, the
 * query-filter sibling of the path-segment guards in the forms and questions
 * slices). Without the bound the value went to Postgres, which refused the
 * parameter with "value out of range for type integer" - an unexpected throw,
 * so the request 500ed where every other unusable `version` value 400s.
 */
const MAX_VERSION = 2_147_483_647;

/** Parse a `version` query value to an in-range positive integer, or 400. */
function parseVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VERSION) {
    throw fail.invalidQuery("version must be a positive integer");
  }
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

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const { rows, total } = await listResponses(request.exec, request.environment, {
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
    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const detail = await getResponse(request.exec, request.environment, formId, sessionId);
    if (detail === undefined) throw fail.responseNotFound();

    // The append-only answer ledger - the audit history (every revision, oldest
    // first). Present because the session is non-erased (erasure deletes it).
    const ledger = await answerLedger(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      sessionId,
    );

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
        // A retraction revision is carried explicitly (`retracted: true`, no
        // value), never flattened into a value-less answer (ADR-33).
        ledger: ledger.map((entry) => ({
          questionId: entry.questionId,
          value: entry.value,
          retracted: entry.retracted,
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
      const stream = jsonExportStream(deps.databases.forRequest(c.get("requestEnvironment")), {
        formId,
        ...filter,
      });
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
    const shape: ExportShape = q.shape ?? LONG_SHAPE;
    const formVersion = await getFormVersion(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      version,
    );
    if (formVersion === undefined) throw fail.versionNotFound();
    const definition = formVersion.definition satisfies FormDefinition;
    const columns = responseColumns(definition, shape);
    const groups = shape === LONG_SHAPE ? groupFileColumns(definition) : [];
    const pageFilter = { formId, version, from: filter.from, to: filter.to };
    const name = `${formId}-v${String(version)}-responses`;

    // The long shape of a version with at least one repeating group is more than
    // one file, so it downloads as a zip. A version with none downloads exactly
    // the single file it always did - same bytes, same content type, same name -
    // so no existing adopter's pipeline moves (Q17).
    if (groups.length > 0) {
      return new Response(
        zipExportStream(
          deps.databases.forRequest(c.get("requestEnvironment")),
          pageFilter,
          columns,
          groups,
        ),
        {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${name}.zip"`,
          },
        },
      );
    }

    return new Response(
      csvExportStream(deps.databases.forRequest(c.get("requestEnvironment")), pageFilter, columns),
      {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.csv"`,
        },
      },
    );
  };
}

/**
 * The pool one request is served from, resolved once by the handler and carried into the
 * export streams.
 *
 * The streams outlive the handler frame that built them - a `ReadableStream`'s `pull` runs
 * long after the response has been returned - so the environment the Q6 switcher named has
 * to be captured when the handler still has its context, not read again per page. Passing
 * the resolved pair rather than `Deps` is what makes that structural: there is no
 * `databases` in scope inside a stream to resolve it from a second time.
 */
type RequestDatabase = ReturnType<Databases["forRequest"]>;

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
  request: RequestDatabase,
  filter: ExportFilter,
  columns: readonly ResponseColumn[],
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
      const rows = await nextPage(request, filter, after);
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
 * The long shape of a version with repeating groups: a zip of `responses.csv` and
 * one file per group, each file its own pass over the reporting view (task 075).
 *
 * **One pass per file rather than one pass filling several buffers**, because a zip
 * entry has to be written whole before the next one starts and the alternative is
 * holding every group's rows in memory until the flat file is finished. The cost is
 * `1 + groups` keyset scans of the same filtered rows.
 *
 * **What the memory bound is, stated exactly.** `zipStream` runs one unit of work
 * per `pull` and a `pull` takes one chunk, so a chunk here is one keyset page and
 * the queued bytes are one page plus two small records, exactly as the single-file
 * path at {@link csvExportStream} is. That is a property of `zipStream` rather than
 * of this function, and `@roonga/qcms-csv`'s demand test is what holds it: an
 * earlier revision walked a whole entry inside one `pull` and queued the whole file,
 * because `controller.enqueue` never blocks and a `ReadableStream` applies
 * backpressure only by withholding the next `pull`.
 *
 * `zipStream` also asks for each entry only once the previous one is closed, so the
 * passes are sequential by construction and never two cursors at once.
 */
function zipExportStream(
  request: RequestDatabase,
  filter: ExportFilter,
  columns: readonly ResponseColumn[],
  groups: readonly GroupFileColumns[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  /** One file's bytes: its header, then one chunk per keyset page. */
  async function* file(
    header: string,
    body: (row: ReportingResponseRow) => string,
  ): AsyncIterable<Uint8Array> {
    yield encoder.encode(UTF8_BOM + header);
    let after: SessionId | undefined;
    for (;;) {
      const rows = await nextPage(request, filter, after);
      if (rows.length === 0) return;
      let chunk = "";
      for (const row of rows) chunk += body(row);
      if (chunk !== "") yield encoder.encode(chunk);
      after = lastSessionId(rows);
      if (rows.length < EXPORT_PAGE_SIZE) return;
    }
  }

  // A plain generator: deciding WHICH file comes next needs no await, and each
  // entry's own content is the async iterable that does the paging.
  function* entries(): Iterable<ZipEntry> {
    yield {
      name: RESPONSES_FILE_NAME,
      content: file(csvHeaderRow(columns), (row) => csvDataRow(row, columns)),
    };
    for (const group of groups) {
      yield {
        name: groupFileName(group.groupId),
        content: file(groupHeaderRow(group), (row) => groupDataRows(row, group)),
      };
    }
  }

  return zipStream(entries());
}

/**
 * A memory-bounded JSON array stream: emit `[`, then reporting rows keyset-paged
 * and comma-separated, then `]`. Same bounded working set as CSV.
 */
function jsonExportStream(
  request: RequestDatabase,
  filter: ExportFilter,
): ReadableStream<Uint8Array> {
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
      const rows = await nextPage(request, filter, after);
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
  request: RequestDatabase,
  filter: ExportFilter,
  after: SessionId | undefined,
): Promise<ReportingResponseRow[]> {
  return fetchResponsePage(request.exec, request.environment, {
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

// --- POST /admin/forms/:id/responses/:sessionId/erase -----------------------

export function makeEraseHandler(deps: Deps): RouteHandler<typeof eraseRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);
    const { reason } = c.req.valid("json");

    try {
      // eraseSession is idempotent (returns the existing tombstone with
      // alreadyErased:true) and owns its own transaction (016).
      //
      // Form-scoped (#305): the form is passed *into* the erasure, where it filters
      // both the tombstone lookup and the session lookup, rather than being compared
      // against the outcome here. That ordering is the point - a comparison after
      // the fact would run once the deletes had already happened.
      const outcome = await eraseSession(
        deps.databases.forRequest(c.get("requestEnvironment")).exec,
        formId,
        sessionId,
        reason,
      );
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

    const rows = await listTombstones(deps.databases.forRequest(c.get("requestEnvironment")).exec, {
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

// --- POST /admin/forms/:id/responses/:sessionId/unflag ----------------------

export function makeUnflagHandler(deps: Deps): RouteHandler<typeof unflagRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);

    // Form scope first, and by query rather than by comparison (#305): a session of
    // another form is not returned at all, so it takes the same 404 as an id that
    // does not exist. This read also supplies the formId/formVersion the released
    // event carries, so scoping costs no extra round trip - the handler already
    // needed the session row.
    const session = await getSessionInForm(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      sessionId,
    );
    if (session === undefined) throw fail.sessionNotFound();

    // The submission carries the audit payload (contentHash, locked answers) the
    // withheld event needs; a session without one has nothing to release → 404.
    // Safe unscoped: the session it belongs to is proven in-form immediately above,
    // and a submission is keyed by that session.
    const submission = await getSubmission(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      sessionId,
    );
    if (submission === undefined) throw fail.submissionNotFound();

    // One transaction: the conditional flag-clear and the released event commit
    // together (transactional outbox, §11). `clearSubmissionFlag` is race-safe -
    // only the caller that actually flips the flag gets `true`, so the event is
    // enqueued exactly once even under concurrent unflags (idempotent).
    const released = await deps.databases
      .forRequest(c.get("requestEnvironment"))
      .exec.transaction(async (tx) => {
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
