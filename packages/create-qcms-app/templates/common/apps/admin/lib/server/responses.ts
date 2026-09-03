import type {
  EraseOutcome,
  LedgerEntry,
  ResponseDetail,
  ResponseListItem,
  ResponsePage,
  Tombstone,
} from "../ops/types.ts";

import { adminApiFetch } from "./api.ts";
import type { AdminApiPath } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The response, erasure and export screens' calls into the API's `/admin` group
 * (task 035, R2).
 *
 * The same proxy shape as `forms.ts` and `links.ts`: attach credentials, forward,
 * parse the payload into the app's own types. Nothing here decides anything. In
 * particular this app does **not** decide that an erased session is hidden - the API
 * reads a reporting view with a tombstone anti-join, so an erased session is absent
 * from the list, absent from the detail (404) and absent from the export by
 * construction, and a bug in this file cannot resurrect one.
 *
 * ## Answer values are payload, never log lines
 *
 * Everything crossing this module carries respondent answers. They are handed to the
 * screen and to the download stream and go nowhere else: no `console`, no error
 * message, no cache key (SEC-8, SEC-13). The export is deliberately a `Response`
 * passed through untouched rather than a parsed structure, so a whole export never
 * lands in this process's memory at once and cannot be accidentally serialized into
 * a log or a React payload.
 */

/** The filters the browser toolbar can apply, all optional. */
export interface ResponseFilters {
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
  readonly flagged?: "true" | "false";
  readonly page?: number;
  readonly pageSize?: number;
}

/** The export dialog's choices. `version` is required by the API for CSV. */
export interface ExportRequest {
  readonly format: "csv" | "json";
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
}

/** Build a query string from the entries that carry a value. */
function query(entries: Readonly<Record<string, string | number | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text.trim() === "") continue;
    search.set(key, text);
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

/** `GET /admin/forms/{id}/responses` - one filtered page of submitted responses. */
export async function listResponses(
  session: AdminSession,
  formId: string,
  filters: ResponseFilters = {},
): Promise<ApiResult<ResponsePage>> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/responses${query({
    version: filters.version,
    from: filters.from,
    to: filters.to,
    flagged: filters.flagged,
    page: filters.page,
    pageSize: filters.pageSize,
  })}`;
  const result = await readResult<Record<string, unknown>>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  const raw = result.data;
  return {
    ok: true,
    data: {
      responses: parseResponses(raw["responses"]),
      page: count(raw["page"], 1),
      pageSize: count(raw["pageSize"], 50),
      total: count(raw["total"], 0),
    },
  };
}

/** `GET /admin/forms/{id}/responses/{sessionId}` - the locked set and its ledger. */
export async function getResponse(
  session: AdminSession,
  formId: string,
  sessionId: string,
): Promise<ApiResult<ResponseDetail>> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(sessionId)}`;
  const result = await readResult<Record<string, unknown>>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  const raw = result.data;
  return {
    ok: true,
    data: {
      sessionId: text(raw["sessionId"], sessionId),
      formId: text(raw["formId"], formId),
      formVersion: count(raw["formVersion"], 0),
      submittedAt: text(raw["submittedAt"], ""),
      accessMode: raw["accessMode"] === "secure_link" ? "secure_link" : "anonymous",
      flaggedReason: nullableText(raw["flaggedReason"]),
      contentHash: text(raw["contentHash"], ""),
      answers: answerMap(raw["answers"]),
      ledger: parseLedger(raw["ledger"]),
    },
  };
}

/**
 * `GET /admin/forms/{id}/export` - the raw streamed `Response`, passed through.
 *
 * Not parsed, not buffered, not re-encoded. The API emits `text/csv` with a UTF-8
 * BOM and CRLF records (or `application/json`), and any of those three that this app
 * touched would change the bytes an operator's spreadsheet opens. The route handler
 * that calls this copies the body and the content headers straight to the browser.
 */
export function exportResponses(
  session: AdminSession,
  formId: string,
  request: ExportRequest,
): Promise<Response> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/export${query({
    format: request.format,
    version: request.version,
    from: request.from,
    to: request.to,
  })}`;
  return adminApiFetch(session, path);
}

/**
 * `POST /admin/forms/{formId}/responses/{sessionId}/erase` - ADR-17, and it does not
 * come back.
 *
 * The API deletes the answers and the submission and writes a tombstone in one
 * transaction. There is no undo anywhere in the system: no soft-delete column, no
 * archive table, no backup this app can reach. The dialog that calls this says so in
 * those terms, and `alreadyErased` lets the screen tell "this call erased it" from
 * "it was already gone" instead of claiming the first for both.
 */
export async function eraseSession(
  session: AdminSession,
  formId: string,
  sessionId: string,
  reason: string,
): Promise<ApiResult<EraseOutcome>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(sessionId)}/erase`,
      { method: "POST", body: { reason } },
    ),
  );
  if (!result.ok) return result;
  const raw = result.data;
  return {
    ok: true,
    data: { ...parseTombstone(raw, sessionId), alreadyErased: raw["alreadyErased"] === true },
  };
}

/** `GET /admin/erasures` - the tombstones, newest first. Compliance evidence. */
export async function listErasures(
  session: AdminSession,
  formId?: string,
): Promise<ApiResult<readonly Tombstone[]>> {
  const path: AdminApiPath = `/erasures${query({ formId })}`;
  const result = await readResult<{ erasures?: unknown }>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.erasures)
      .filter((entry) => typeof entry["sessionId"] === "string")
      .map((entry) => parseTombstone(entry, entry["sessionId"] as string)),
  };
}

/**
 * `POST /admin/forms/{formId}/responses/{sessionId}/unflag` - release a withheld
 * webhook event.
 *
 * A flagged submission (020/026 honeypot or minimum-time) is stored but its
 * `response.submitted` event is held back, so consumers never saw it. Unflagging
 * releases that event, which is a one-way door in the same sense a delivery is: once
 * the consumer has it, this app cannot recall it. `released` reports whether THIS
 * call did the releasing, so a second press does not claim the same thing twice.
 */
export async function unflagResponse(
  session: AdminSession,
  formId: string,
  sessionId: string,
): Promise<ApiResult<{ readonly sessionId: string; readonly released: boolean }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(sessionId)}/unflag`,
      { method: "POST" },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      sessionId: text(result.data["sessionId"], sessionId),
      released: result.data["released"] === true,
    },
  };
}

// --- reading the API's payloads ---------------------------------------------

function text(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function nullableText(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function count(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function rows(raw: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

/**
 * The answers object, carried through with its values untouched.
 *
 * Only the shape is checked (an object keyed by questionId). The values stay
 * `unknown`: they are canonical encodings and this app must not narrow, coerce or
 * re-encode them, because the detail view's whole claim is that it shows what was
 * locked.
 */
function answerMap(raw: unknown): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function parseResponses(raw: unknown): readonly ResponseListItem[] {
  return rows(raw)
    .filter((entry) => typeof entry["sessionId"] === "string")
    .map((entry) => ({
      sessionId: entry["sessionId"] as string,
      formVersion: count(entry["formVersion"], 0),
      submittedAt: text(entry["submittedAt"], ""),
      accessMode:
        entry["accessMode"] === "secure_link" ? ("secure_link" as const) : ("anonymous" as const),
      flaggedReason: nullableText(entry["flaggedReason"]),
      answers: answerMap(entry["answers"]),
    }));
}

/**
 * Read the ledger.
 *
 * `retracted` defaults to `false` only when the field is absent, and a row with no
 * `questionId` is dropped rather than rendered anonymously: a timeline entry that
 * cannot say which question it belongs to is not audit evidence.
 */
function parseLedger(raw: unknown): readonly LedgerEntry[] {
  return rows(raw)
    .filter((entry) => typeof entry["questionId"] === "string")
    .map((entry) => ({
      questionId: entry["questionId"] as string,
      value: entry["value"],
      retracted: entry["retracted"] === true,
      answeredAt: text(entry["answeredAt"], ""),
    }));
}

function parseTombstone(entry: Record<string, unknown>, sessionId: string): Tombstone {
  return {
    sessionId: text(entry["sessionId"], sessionId),
    formId: text(entry["formId"], ""),
    formVersion: count(entry["formVersion"], 0),
    erasedAt: text(entry["erasedAt"], ""),
    reason: text(entry["reason"], ""),
  };
}
