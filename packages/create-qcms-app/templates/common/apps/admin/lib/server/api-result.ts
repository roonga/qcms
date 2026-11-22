import { messageForFormCode } from "../forms/errors.ts";
import { parseIssues } from "../forms/issues.ts";
import type { FormIssue } from "../forms/types.ts";

/** Normalise presentation envelopes only; the API remains the authority on success and refusal. */

export type ApiResult<T> =
  /** `held` is a 202: the API stored the act as a request an Approver has to approve. */
  | { readonly ok: true; readonly data: T; readonly held?: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly issues: readonly FormIssue[];
    };

/** Schema middleware can refuse without an error code. Kernel publish issues arrive in details.issues on 422 as well as in successful validation. */
async function readFailure(response: Response): Promise<ApiResult<never>> {
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = (body as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : `http_${response.status}`;
  const details = envelope?.details as
    { issues?: unknown; questionId?: unknown; reason?: unknown } | undefined;
  return {
    ok: false,
    code,
    /** Read only named detail fields to select or interpolate catalog copy. Never render the envelope message: upstream error text is not trusted UI copy. */
    message: messageForFormCode(code, {
      question: typeof details?.questionId === "string" ? details.questionId : undefined,
      reason: firstIssueMessage(details?.issues),
      rejection: typeof details?.reason === "string" ? details.reason : undefined,
    }),
    issues: parseIssues(details?.issues),
  };
}

/** Definition issues have array paths; publish issues have structured paths. This channel needs the definition reader. */
function firstIssueMessage(issues: unknown): string | undefined {
  if (!Array.isArray(issues)) return undefined;
  const message = (issues[0] as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

export async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  if (!response.ok) return readFailure(response);
  return {
    ok: true,
    data: (await response.json()) as T,
    ...(response.status === HELD ? { held: true as const } : {}),
  };
}

/** A 204 has no JSON body; parsing it would report failure after the API performed the action. */
export async function readNoContent(response: Response): Promise<ApiResult<null>> {
  if (!response.ok) return readFailure(response);
  return { ok: true, data: null, ...(response.status === HELD ? { held: true as const } : {}) };
}

/** A 202 is the API's hold: the act was stored as a request an Approver has to approve. */
export const HELD = 202;
