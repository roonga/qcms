import { messageForFormCode } from "../forms/errors.ts";
import { parseIssues } from "../forms/issues.ts";
import type { FormIssue } from "../forms/types.ts";

/**
 * The one shape every admin screen renders an API answer in (tasks 032-034).
 *
 * It was `forms.ts`'s private helper until the secure-links proxy needed exactly the same
 * normalisation (034). Two callers is the moment to share rather than copy: a second
 * envelope reader would be a second place for the API's two error shapes to be handled
 * slightly differently, and the whole point of this type is that a screen has one error
 * path instead of two.
 *
 * It is presentation, not authority. Nothing here decides whether a request should have
 * succeeded; it reads what came back (R2).
 */

/** Success carries the parsed payload; failure carries the API's code and its issues. */
export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly issues: readonly FormIssue[];
    };

/**
 * Read a non-2xx into the failure shape.
 *
 * Two envelopes exist and both have to be survivable: the API's own errors are
 * `{ error: { code, message, details } }`, while a request that fails a route's Zod schema
 * before any handler runs is answered by the validator middleware with a body carrying no
 * `code` at all. `details.issues` is where a 422 puts the kernel's `PublishError[]`, so a
 * rejected save arrives with the same issue list a successful one would have carried and
 * the panel renders it the same way.
 */
async function readFailure(response: Response): Promise<ApiResult<never>> {
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = (body as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : `http_${response.status}`;
  const details = envelope?.details as { issues?: unknown } | undefined;
  return {
    ok: false,
    code,
    message: messageForFormCode(code),
    issues: parseIssues(details?.issues),
  };
}

/** Parse a 2xx body, or normalise the failure. */
export async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  if (!response.ok) return readFailure(response);
  return { ok: true, data: (await response.json()) as T };
}
