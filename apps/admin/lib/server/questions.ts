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

import { adminApiFetch } from "./api.ts";
import type { AdminSession } from "./session.ts";

/**
 * The question library's calls into the API's `/admin` group (task 032, R2).
 *
 * Every one of these is a proxy: build a path, hand it to the one credentialed client
 * (`api.ts`), read the response. There is no rule here, no validation, no derived
 * decision about what a question means - the API owns all of that, and the R2
 * import-surface test is what keeps this file honest (it forbids `@roonga/qcms-core` outright
 * and allows a request to be built in exactly one module).
 *
 * The one thing this file does add is a shape: `ApiResult`. A screen has to render an
 * error, and "the caller decides how to read a non-2xx" (see `api.ts`) means every screen
 * would otherwise re-derive envelope parsing. Normalising it once here is presentation,
 * not authority: the code and the issue paths are passed through untouched, so the API
 * remains the thing that said what went wrong.
 */

/** Success carries the parsed payload; failure carries the API's own code and issues. */
export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly issues: readonly DefinitionIssue[];
    };

/**
 * Read a non-2xx into the failure shape.
 *
 * Two envelopes exist and both have to be survivable. The API's own errors are
 * `{ error: { code, message, details } }`. A request that fails the route's Zod schema
 * before any handler runs is answered by the validator middleware instead, with a body
 * that has no `code` at all - so a screen that assumed the first shape would render
 * "undefined". That path is reachable from here (a definition that is not a JSON object,
 * a missing slug), so it gets the generic sentence rather than a crash.
 */
async function readFailure(response: Response): Promise<ApiResult<never>> {
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = (body as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : `http_${response.status}`;
  const details = envelope?.details as { issues?: unknown } | undefined;
  const issues = Array.isArray(details?.issues) ? (details.issues as DefinitionIssue[]) : [];
  return { ok: false, code, message: messageForCode(code), issues };
}

/** Parse a 2xx body, or normalise the failure. */
async function read<T>(response: Response): Promise<ApiResult<T>> {
  if (!response.ok) return readFailure(response);
  return { ok: true, data: (await response.json()) as T };
}

/** `GET /admin/questions` - status and free-text filters are the API's, not ours. */
export async function listQuestions(
  session: AdminSession,
  filters: {
    readonly status?: QuestionStatus;
    readonly type?: QuestionType;
    readonly search?: string;
  } = {},
): Promise<ApiResult<readonly QuestionListItem[]>> {
  const query = new URLSearchParams();
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.type !== undefined) query.set("type", filters.type);
  if (filters.search !== undefined && filters.search.trim() !== "") {
    query.set("search", filters.search.trim());
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const result = await read<{ questions: QuestionListItem[] }>(
    await adminApiFetch(session, `/questions${suffix}`),
  );
  return result.ok ? { ok: true, data: result.data.questions } : result;
}

/** `GET /admin/questions/{id}` - the question and every version, oldest first. */
export async function getQuestion(
  session: AdminSession,
  questionId: string,
): Promise<ApiResult<QuestionDetail>> {
  return read<QuestionDetail>(
    await adminApiFetch(session, `/questions/${encodeURIComponent(questionId)}`),
  );
}

/**
 * `GET /admin/questions/{id}/versions/{v}/preview` - the A2UI document for one version.
 *
 * The compile happens in the API, on purpose (task 032's preview decision): the admin
 * never runs the compiler, so preview fidelity is not "the same package version" but
 * literally the same code path publishing uses, and the BFF keeps no domain capability
 * it could drift on. See `components/questions/question-preview.tsx` for the render half.
 */
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

/** `POST /admin/questions` - the question and its draft v1, in one call. */
export async function createQuestion(
  session: AdminSession,
  slug: string,
  definition: QuestionDefinitionView,
): Promise<ApiResult<{ questionId: string; slug: string; version: QuestionVersion }>> {
  return read(
    await adminApiFetch(session, `/questions`, {
      method: "POST",
      body: { slug, definition },
    }),
  );
}

/** `PUT /admin/questions/{id}/versions/{v}` - edit a draft. Published versions 409. */
export async function saveVersion(
  session: AdminSession,
  questionId: string,
  version: number,
  definition: QuestionDefinitionView,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}`,
      { method: "PUT", body: { definition } },
    ),
  );
}

/** `POST /admin/questions/{id}/versions` - draft vN+1, seeded from the latest version. */
export async function createVersion(
  session: AdminSession,
  questionId: string,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(session, `/questions/${encodeURIComponent(questionId)}/versions`, {
      method: "POST",
    }),
  );
}

/** `POST .../publish` - freeze a draft and make it pinnable. */
export async function publishVersion(
  session: AdminSession,
  questionId: string,
  version: number,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}/publish`,
      { method: "POST" },
    ),
  );
}

/** `POST .../deprecate` - block new pins. Forms already pinned to it are untouched. */
export async function deprecateVersion(
  session: AdminSession,
  questionId: string,
  version: number,
): Promise<ApiResult<QuestionVersion>> {
  return read<QuestionVersion>(
    await adminApiFetch(
      session,
      `/questions/${encodeURIComponent(questionId)}/versions/${String(version)}/deprecate`,
      { method: "POST" },
    ),
  );
}
