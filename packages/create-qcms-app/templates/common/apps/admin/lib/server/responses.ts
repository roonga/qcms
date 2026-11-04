import type {
  EraseOutcome,
  ErasureScope,
  LedgerEntry,
  ResponseDetail,
  ResponseListItem,
  ResponsePage,
  Tombstone,
} from "../ops/types.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { AdminApiPath } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Respondent answers may reach screens and streams only, never logs, errors or cache keys. Pass exports through without buffering the entire response. */

export interface ResponseFilters {
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
  readonly flagged?: "true" | "false";
  readonly page?: number;
  readonly pageSize?: number;
}

/** CSV requires version; omitted shape uses the API long default. */
export interface ExportRequest {
  readonly format: "csv" | "json";
  readonly shape?: "long" | "wide";
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
}

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

/** Preserve export bytes, including CSV BOM and CRLF. Relay the body and content headers without parsing or re-encoding. */
export function exportResponses(
  session: AdminSession,
  formId: string,
  request: ExportRequest,
): Promise<Response> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/export${query({
    format: request.format,
    shape: request.shape,
    version: request.version,
    from: request.from,
    to: request.to,
  })}`;
  return adminApiFetch(session, path);
}

/** Erasure is irreversible; alreadyErased distinguishes a newly completed act from an earlier one. */
export async function eraseSession(
  session: AdminSession,
  formId: string,
  sessionId: string,
  reason: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<EraseOutcome>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(sessionId)}/erase`,
      { method: "POST", body: { reason }, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  const raw = result.data;
  return {
    ok: true,
    data: { ...parseTombstone(raw, sessionId), alreadyErased: raw["alreadyErased"] === true },
  };
}

/** Cross-environment erasure is navigation to a fresh confirmation per environment, never an automatic loop. A missing hint must not block this response screen. */
export async function erasureScope(
  session: AdminSession,
  formId: string,
  sessionId: string,
): Promise<ApiResult<ErasureScope>> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(sessionId)}/erasure-scope`;
  const result = await readResult<Record<string, unknown>>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  const raw = result.data;
  const others = Array.isArray(raw["otherEnvironments"]) ? raw["otherEnvironments"] : [];
  return {
    ok: true,
    data: {
      sessionId: text(raw["sessionId"], sessionId),
      environment: text(raw["environment"], ""),
      alreadyErased: raw["alreadyErased"] === true,
      otherEnvironments: others.flatMap((entry) => {
        /** Payload fields are unknown at the wire boundary; widen to a record before checking each one. */
        const row = entry as { environment?: unknown; alreadyErased?: unknown };
        if (typeof row.environment !== "string" || row.environment === "") return [];
        return [{ environment: row.environment, alreadyErased: row.alreadyErased === true }];
      }),
    },
  };
}

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

/** Unflagging releases the withheld event irreversibly; released distinguishes this call from repeat presses. */
export async function unflagResponse(
  session: AdminSession,
  formId: string,
  sessionId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly sessionId: string; readonly released: boolean }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(sessionId)}/unflag`,
      { method: "POST", headers: proposalHeaders(proposal) },
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

/** Answer values stay unknown and untouched: canonical encodings must not be coerced or re-encoded when showing the locked response. */
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

/** Drop ledger entries with no question ID; anonymous entries are not audit evidence. */
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
