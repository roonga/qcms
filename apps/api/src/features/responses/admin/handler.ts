/**
 * Every read path goes through `reporting.responses`, whose tombstone anti-join
 * excludes erased and non-submitted sessions by construction, so no handler here
 * reads `submissions`/`answers` for content. Answer values are never logged (SEC-8).
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
  findSubjectPresence,
  getFormVersion,
  getResponse,
  getSessionInForm,
  getSubmission,
  listResponses,
  listTombstones,
  type ReportingResponseRow,
  SessionNotFoundError,
  writeAccessAuditRow,
  type Executor,
} from "@roonga/qcms-db";
import { responseExportFileName, zipStream, type ZipEntry } from "@roonga/qcms-csv";

import type { Databases } from "../../../environments.js";
import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { agentStepSite, writeAgentStep } from "../../agent/audit.js";
import type { GrantContext } from "../../membership/context.js";
import { decideAccess } from "../../membership/policy.js";
import { holdsInstallationClaim, resolveGrants } from "../../membership/resolver.js";
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
  erasureScopeRoute,
  exportRoute,
  getResponseRoute,
  listErasuresRoute,
  listResponsesRoute,
  unflagRoute,
} from "./route.js";

const RESPONSE_SUBMITTED = "response.submitted" as const;

const EXPORT_PAGE_SIZE = 500;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

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

/** `form_versions.version` is `int4`: without this bound Postgres throws and the request 500s. */
const MAX_VERSION = 2_147_483_647;

function parseVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VERSION) {
    throw fail.invalidQuery("version must be a positive integer");
  }
  return n;
}

function parseDate(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw fail.invalidQuery(`${field} must be an ISO date-time`);
  return d;
}

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

/**
 * The SEC-15 row rides the read's own transaction on the environment pool, so an act
 * and the record of it commit or fail together. It carries no foreign key into what it
 * describes (that would cascade away with it), and no answer value or question text.
 */
async function recordResponseAccess(
  exec: Executor,
  input: {
    readonly grant: GrantContext | undefined;
    readonly actorId: string | undefined;
    readonly environment: string;
    readonly formId: string;
    readonly kind: "read" | "export" | "erasure";
    readonly at: Date;
  },
): Promise<void> {
  // The workspace the grant middleware judged the act against, not one resolved again here.
  const workspaceId = input.grant?.workspaceId;
  if (workspaceId === undefined || input.actorId === undefined) {
    throw new ApiError(
      "AUDIT_ACTOR_UNRESOLVED",
      500,
      "A response access could not be audited, so it is refused: SEC-15 records every " +
        "read, export and erasure, and a read without its row is the one failure this " +
        "control may not have.",
    );
  }
  await writeAccessAuditRow(exec, {
    actor: input.actorId,
    workspaceId,
    environment: input.environment,
    formId: input.formId,
    kind: input.kind,
    occurredAt: input.at,
  });
}

export function makeListResponsesHandler(
  deps: Deps,
): RouteHandler<typeof listResponsesRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const q = c.req.valid("query");
    const filter = parseFilter(q);
    const { page, pageSize, limit, offset } = pageWindow(q.page, q.pageSize);

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    // The audit row is written first, so a read can never be served without one (SEC-15).
    const { rows, total } = await request.exec.transaction(async (tx) => {
      await recordResponseAccess(tx, {
        grant: c.get("grantContext"),
        actorId: c.get("adminPrincipal")?.userId,
        environment: request.environment,
        formId,
        kind: "read",
        at: deps.clock.now(),
      });
      return listResponses(tx, request.environment, {
        formId,
        ...filter,
        ...(q.flagged !== undefined ? { flagged: q.flagged === "true" } : {}),
        limit,
        offset,
      });
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

export function makeGetResponseHandler(deps: Deps): RouteHandler<typeof getResponseRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);

    // The reporting view: an erased session is absent, so detail cannot bypass the exclusion.
    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const read = await request.exec.transaction(async (tx) => {
      await recordResponseAccess(tx, {
        grant: c.get("grantContext"),
        actorId: c.get("adminPrincipal")?.userId,
        environment: request.environment,
        formId,
        kind: "read",
        at: deps.clock.now(),
      });
      // A read that found nothing is still a read: the transaction commits, so the row stays.
      const found = await getResponse(tx, request.environment, formId, sessionId);
      if (found === undefined) return undefined;
      return { detail: found, ledger: await answerLedger(tx, sessionId) };
    });
    if (read === undefined) throw fail.responseNotFound();
    const { detail, ledger } = read;

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
          retracted: entry.retracted,
          answeredAt: entry.answeredAt.toISOString(),
        })),
      },
      200,
    );
  };
}

export function makeExportHandler(deps: Deps): RouteHandler<typeof exportRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const q = c.req.valid("query");
    const format = q.format ?? "csv";
    const filter = parseFilter(q);

    // A stream outlives any transaction, so the audit row is written first in its own,
    // and failing to write it refuses the export: no path exports without a row (SEC-15).
    const auditExec = deps.databases.forRequest(c.get("requestEnvironment"));
    await auditExec.exec.transaction(async (tx) => {
      await recordResponseAccess(tx, {
        grant: c.get("grantContext"),
        actorId: c.get("adminPrincipal")?.userId,
        environment: auditExec.environment,
        formId,
        kind: "export",
        at: deps.clock.now(),
      });
    });

    if (format === "json") {
      const stream = jsonExportStream(deps.databases.forRequest(c.get("requestEnvironment")), {
        formId,
        ...filter,
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${responseExportFileName({
            formId,
            environment: auditExec.environment,
            extension: "json",
          })}"`,
        },
      });
    }

    // CSV columns depend on the version's shape, so a version is required.
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
    const nameFor = (extension: "csv" | "zip"): string =>
      responseExportFileName({
        formId,
        environment: auditExec.environment,
        version,
        extension,
      });

    // More than one file, so it downloads as a zip; a version with no group stays a
    // single CSV with the same bytes, so no adopter's pipeline moves.
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
            "content-disposition": `attachment; filename="${nameFor("zip")}"`,
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
          "content-disposition": `attachment; filename="${nameFor("csv")}"`,
        },
      },
    );
  };
}

/**
 * A stream's `pull` runs after the handler has returned, so the request's environment is
 * captured here rather than resolved again per page.
 */
type RequestDatabase = ReturnType<Databases["forRequest"]>;

interface ExportFilter {
  formId: FormId;
  version?: number | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

/** One keyset page per pull, so the export holds O(page) rather than O(table). */
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
 * One pass per file: a zip entry is written whole before the next starts, and
 * `zipStream` asks for an entry only once the previous closed, so cursors never overlap.
 */
function zipExportStream(
  request: RequestDatabase,
  filter: ExportFilter,
  columns: readonly ResponseColumn[],
  groups: readonly GroupFileColumns[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

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

function lastSessionId(rows: ReportingResponseRow[]): SessionId {
  return rows[rows.length - 1]!.sessionId;
}

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

export function makeEraseHandler(deps: Deps): RouteHandler<typeof eraseRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);
    const { reason } = c.req.valid("json");

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    try {
      // The form is passed into the erasure so it filters the lookups, rather than being
      // compared against the outcome once the deletes have happened. The SEC-15 row rides
      // the same transaction: an erasure cannot be repeated to produce its record later.
      const outcome = await request.exec.transaction(async (tx) => {
        await recordResponseAccess(tx, {
          grant: c.get("grantContext"),
          actorId: c.get("adminPrincipal")?.userId,
          environment: request.environment,
          formId,
          kind: "erasure",
          at: deps.clock.now(),
        });
        return eraseSession(tx, formId, sessionId, reason);
      });
      // The act is in the environment's database and the step row is in the control one, so
      // the two cannot share a transaction. The row is written once the erasure has
      // committed, which keeps the property that matters: a step that failed wrote no row.
      await writeAgentStep(deps.databases.control, agentStepSite(c), reason, deps.clock.now());
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

/**
 * It offers and never performs: a `GET` that writes nothing, so each repetition stays a
 * separate erase with its own confirmation. It writes no SEC-15 row because it reads no
 * response, only whether a session id exists in a form in an environment.
 */
export function makeErasureScopeHandler(
  deps: Deps,
): RouteHandler<typeof erasureScopeRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);
    const request = deps.databases.forRequest(c.get("requestEnvironment"));

    // A screen that is not showing a response has nothing to offer a repetition of.
    const here = await findSubjectPresence(request.exec, formId, sessionId);
    if (!here.hasSession && !here.alreadyErased) throw fail.sessionNotFound();

    const grant = c.get("grantContext");
    const principal = c.get("adminPrincipal");
    // Each other environment is asked the same authorisation question, so existence is
    // never disclosed where the caller holds nothing.
    const resolved =
      grant?.workspaceId === undefined || principal === undefined
        ? undefined
        : await resolveGrants(deps.databases.control, {
            userId: principal.userId,
            workspaceId: grant.workspaceId,
            claim: holdsInstallationClaim(principal.role),
          });

    const others: { environment: string; alreadyErased: boolean }[] = [];
    for (const environment of deps.databases.names) {
      if (environment === request.environment) continue;
      const allowed =
        resolved !== undefined &&
        decideAccess({
          memberRole: resolved.memberRole,
          grants: resolved.grants,
          request: { resource: "response", action: "erase", environment, formId },
        }).allowed;
      if (!allowed) continue;
      const presence = await findSubjectPresence(
        deps.databases.for(environment),
        formId,
        sessionId,
      );
      // An already-erased environment is still offered, with the flag: an operator
      // working a subject request needs to read "already done there".
      if (!presence.hasSession && !presence.alreadyErased) continue;
      others.push({ environment, alreadyErased: presence.alreadyErased });
    }

    return c.json(
      {
        sessionId,
        environment: request.environment,
        alreadyErased: here.alreadyErased,
        otherEnvironments: others,
      },
      200,
    );
  };
}

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

export function makeUnflagHandler(deps: Deps): RouteHandler<typeof unflagRoute, ApiEnv> {
  return async (c) => {
    const { id, sessionId: rawSession } = c.req.valid("param");
    const formId = requireFormId(id);
    const sessionId = requireSessionId(rawSession);

    // Scoped by query rather than by comparison: another form's session is not returned
    // at all, so it takes the same 404 as an id that does not exist.
    const session = await getSessionInForm(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      sessionId,
    );
    if (session === undefined) throw fail.sessionNotFound();

    // Safe unscoped: the session was proven in-form above, and a submission is keyed by it.
    const submission = await getSubmission(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      sessionId,
    );
    if (submission === undefined) throw fail.submissionNotFound();

    // Only the caller that actually flips the flag gets `true`, so concurrent unflags
    // enqueue the released event exactly once, and it commits with the flag clear.
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
              // The locked answers exclude hidden questions (I6); never the raw ledger.
              answers: submission.lockedAnswers.answers,
            },
          });
        }
        return flipped;
      });

    await writeAgentStep(
      deps.databases.control,
      agentStepSite(c),
      deps.databases.forRequest(c.get("requestEnvironment")).environment,
      deps.clock.now(),
    );
    return c.json({ sessionId, released }, 200);
  };
}
