import { cache } from "react";

import { messageForCode } from "../questions/errors.ts";
import type {
  DefinitionIssue,
  PreviewDocument,
  QuestionDefinitionView,
  QuestionDetail,
  QuestionListItem,
  QuestionStatus,
  QuestionType,
  QuestionVersion,
} from "../questions/types.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { AdminSession } from "./session.ts";

/** Normalise API answers for presentation only; domain validation and compilation stay in the API. */

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly issues: readonly DefinitionIssue[];
    };

/** Schema middleware can return an envelope without an error code; fall back to generic copy rather than rendering undefined. */
async function readFailure(response: Response): Promise<ApiResult<never>> {
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = (body as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : `http_${response.status}`;
  const details = envelope?.details as { issues?: unknown } | undefined;
  const issues = Array.isArray(details?.issues) ? (details.issues as DefinitionIssue[]) : [];
  return { ok: false, code, message: messageForCode(code), issues };
}

async function read<T>(response: Response): Promise<ApiResult<T>> {
  if (!response.ok) return readFailure(response);
  return { ok: true, data: (await response.json()) as T };
}

/** `workspaceId` is the current workspace: a question never belongs to two, so one list never spans two. */
export async function listQuestions(
  session: AdminSession,
  filters: {
    readonly status?: QuestionStatus;
    readonly type?: QuestionType;
    readonly search?: string;
    readonly workspaceId?: string;
  } = {},
): Promise<ApiResult<readonly QuestionListItem[]>> {
  const query = new URLSearchParams();
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.type !== undefined) query.set("type", filters.type);
  if (filters.workspaceId !== undefined) query.set("workspaceId", filters.workspaceId);
  if (filters.search !== undefined && filters.search.trim() !== "") {
    query.set("search", filters.search.trim());
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const result = await read<{ questions: QuestionListItem[] }>(
    await adminApiFetch(session, `/questions${suffix}`),
  );
  return result.ok ? { ok: true, data: result.data.questions } : result;
}

/** React cache deduplicates the page and rail only within the request. Its session argument keys by identity and must come from the memoized session reader. */
export const getQuestion: (
  session: AdminSession,
  questionId: string,
) => Promise<ApiResult<QuestionDetail>> = cache(
  async (session: AdminSession, questionId: string): Promise<ApiResult<QuestionDetail>> =>
    read<QuestionDetail>(
      await adminApiFetch(session, `/questions/${encodeURIComponent(questionId)}`),
    ),
);

/** Compile previews in the API so they use the same path as publication; the BFF keeps no compiler authority. */
export async function getPreview(
  session: AdminSession,
  questionId: string,
  version: number,
): Promise<ApiResult<PreviewDocument>> {
  return read<PreviewDocument>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}/preview`,
    ),
  );
}

export async function createQuestion(
  session: AdminSession,
  slug: string,
  definition: QuestionDefinitionView,
  workspaceId?: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ questionId: string; slug: string; version: QuestionVersion }>> {
  return read(
    await adminApiFetch(session, `/questions`, {
      method: "POST",
      body: { slug, definition, ...(workspaceId === undefined ? {} : { workspaceId }) },
      headers: proposalHeaders(proposal),
    }),
  );
}

export async function saveVersion(
  session: AdminSession,
  questionId: string,
  version: number,
  definition: QuestionDefinitionView,
  proposal?: AgentProposalRef,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}`,
      { method: "PUT", body: { definition }, headers: proposalHeaders(proposal) },
    ),
  );
}

export async function createVersion(
  session: AdminSession,
  questionId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(session, `/questions/${encodeURIComponent(questionId)}/versions`, {
      method: "POST",
      headers: proposalHeaders(proposal),
    }),
  );
}

export async function publishVersion(
  session: AdminSession,
  questionId: string,
  version: number,
  proposal?: AgentProposalRef,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}/publish`,
      { method: "POST", headers: proposalHeaders(proposal) },
    ),
  );
}

export async function deprecateVersion(
  session: AdminSession,
  questionId: string,
  version: number,
  proposal?: AgentProposalRef,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}/deprecate`,
      { method: "POST", headers: proposalHeaders(proposal) },
    ),
  );
}
