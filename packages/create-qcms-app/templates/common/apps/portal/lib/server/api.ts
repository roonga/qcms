import type { A2UIAnswerValue } from "@roonga/qcms-ui";

import { CLIENT_ADDRESS_HEADER, currentClientAddress } from "./client-address";
import { INTERNAL_TOKEN_HEADER, apiBaseUrl, internalToken } from "./config";
import { REQUEST_ID_HEADER, currentRequestId } from "./request-id";
import { serverLogger } from "./logger";

/**
 * The strict BFF's internal API client (task 029, R2).
 *
 * This module is proxy + credential duty ONLY: it attaches the SEC-4 internal
 * token and (when present) the respondent's session bearer, forwards the call to
 * the server-only internal API, and returns the parsed JSON. It performs NO rule
 * evaluation and NO validation authority - the API owns all of that (R2). It
 * imports nothing from @roonga/qcms-core (enforced by the import-surface test); the
 * types below are structural mirrors of the API's response shapes, not kernel
 * imports.
 */

/** One compiled A2UI step document (served verbatim; ADR-18). `null` when the flow is complete. */
export interface ApiStepDocument {
  readonly stepId: string;
  readonly root: unknown;
}

/** The forward-pass flow projection the API computes (never re-derived here). */
export interface ApiFlowState {
  readonly currentStep: string | null;
  readonly visibleQuestions: readonly string[];
  readonly missingRequired: readonly string[];
  readonly readyToSubmit: boolean;
}

export interface ApiProgress {
  readonly stepIndex: number;
  readonly totalVisibleSteps: number;
}

/**
 * The answers the API already holds for the rendered step's visible questions,
 * keyed by questionId (issue #146). A question with no current answer - including
 * one whose newest ledger row is an ADR-33 retraction - is simply absent.
 *
 * This is how stored answers reach the browser WITHOUT the compiled document
 * carrying them (ADR-18): they ride beside `step`, which stays the immutable,
 * content-only bytes the API serves verbatim. They are display data only; the BFF
 * neither reads nor derives anything from them (R2) - it forwards them, and the
 * renderer shows them.
 */
export type ApiHeldValues = Readonly<Record<string, A2UIAnswerValue>>;

/**
 * One repeating group's live instance roster (task 073, ADR-42, ADR-43): already
 * derived and already truncated by the API, in roster order.
 *
 * This is how the roster reaches the renderer. A compiled `RepeatGroup` is a
 * **template** carrying its member controls once - the compiler is answer-blind and
 * an instance count is answer-dependent - so the renderer clones it per live
 * instance, and the roster travels beside the document exactly as `values` do. The
 * portal reads it and derives nothing from it (R2).
 */
export interface ApiGroupRoster {
  readonly groupId: string;
  readonly instances: readonly string[];
}

/** GET /sessions/:id/step and POST /sessions/:id/answers both return this shape. */
export interface StepResponse {
  readonly step: ApiStepDocument | null;
  readonly values: ApiHeldValues;
  readonly a2uiSpecVersion: string;
  readonly flowState: ApiFlowState;
  readonly rosters: readonly ApiGroupRoster[];
  readonly progress: ApiProgress;
}

/** One entry of a batch, and one entry the batch refused. */
export interface BatchAnswerEntry {
  readonly questionId: string;
  readonly instanceId?: string;
  readonly value: unknown;
}

export interface BatchRejection {
  readonly questionId: string;
  readonly instanceId?: string;
  readonly code: string;
  readonly details?: unknown;
}

/** POST /sessions/:id/answers/batch: the projection, plus what it refused. */
export interface BatchAnswerResponse extends StepResponse {
  readonly rejected: readonly BatchRejection[];
}

/** POST /sessions/:id/roster: the projection, plus what the operation did. */
export interface RosterOpResponse extends StepResponse {
  /** True when the one-time token had already been spent: nothing was written. */
  readonly replayed: boolean;
  readonly minted: readonly string[];
}

/** POST /sessions success (201). */
export interface StartSessionResponse {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly formVersion: number;
  readonly expiresAt: string;
}

/** POST /sessions/:id/submit success (200) - the receipt. */
export interface SubmitResponse {
  readonly submittedAt: string;
  readonly contentHash: string;
}

/** The API's uniform error envelope: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(`API error ${code} (${String(status)})`);
    this.name = "ApiError";
  }
}

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly details?: unknown;
  };
}

/**
 * Credential + correlation headers for one internal API call.
 *
 * Async since task 054: it also forwards this browser request's `x-request-id`
 * (minted by `proxy.ts`, read back through `headers()`), so the API logs the id
 * the respondent can quote instead of generating an unrelated one. `traceparent`
 * rides the same fetch without appearing here - `@vercel/otel` injects it into
 * outgoing fetches whose URL matches `propagateContextUrls` (see
 * `instrumentation.ts`), which is why this stays proxy + credential duty only.
 *
 * Since issue #341 it also asserts the client address the ingress vouched for, so
 * the API's respondent rate limiters can tell respondents apart at all. The raw
 * `x-forwarded-for` is deliberately NOT forwarded: `client-address.ts` resolves
 * it here, where the number of trusted proxies is known, and vouches for the
 * result on a header the SEC-4 channel protects. Absent a trustworthy address the
 * header is simply omitted and the API falls back to its shared bucket.
 */
async function baseHeaders(token?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [INTERNAL_TOKEN_HEADER]: internalToken(),
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const requestId = await currentRequestId();
  if (requestId !== undefined) headers[REQUEST_ID_HEADER] = requestId;
  const clientAddress = await currentClientAddress();
  if (clientAddress !== undefined) headers[CLIENT_ADDRESS_HEADER] = clientAddress;
  return headers;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let code = "internal";
    let details: unknown;
    if (text !== "") {
      try {
        const envelope = JSON.parse(text) as ErrorEnvelope;
        if (envelope.error?.code !== undefined) code = envelope.error.code;
        details = envelope.error?.details;
      } catch {
        // Non-JSON error body: keep the generic code.
      }
    }
    throw new ApiError(code, res.status, details);
  }
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

async function loggedFetch(
  path: string,
  url: string,
  init: RequestInit,
  requestId: string | undefined,
): Promise<Response> {
  const started = Date.now();
  const response = await fetch(url, init);
  serverLogger.info("api.call", {
    ...(requestId === undefined ? {} : { requestId }),
    method: init.method ?? "GET",
    path,
    status: response.status,
    durationMs: Date.now() - started,
  });
  return response;
}

type StartBody = { readonly formSlug: string } | { readonly token: string };

/** Start a session: anonymous (`{ formSlug }`) or secure-link (`{ token }`). */
export async function startSession(
  body: StartBody & { readonly challengeToken?: string },
): Promise<StartSessionResponse> {
  const headers = await baseHeaders();
  const res = await loggedFetch(
    "/sessions",
    `${apiBaseUrl()}/sessions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<StartSessionResponse>(res);
}

/**
 * The `?step=<index>` suffix for the explicit navigation cursor (ADR-28), or ""
 * when no cursor is requested (resume / no-JS / the first-incomplete default).
 */
function stepQuery(stepIndex?: number): string {
  return stepIndex === undefined ? "" : `?step=${encodeURIComponent(String(stepIndex))}`;
}

/**
 * Fetch a step + flow projection for a session (bearer required). `stepIndex` is
 * the explicit navigation cursor: the 0-based visible-step index to render. Omit
 * it to serve the first incomplete step (resume). The portal reads `flowState`,
 * never re-derives it (R2).
 */
export async function getStep(
  sessionId: string,
  token: string,
  stepIndex?: number,
): Promise<StepResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/step",
    `${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/step${stepQuery(stepIndex)}`,
    {
      headers,
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<StepResponse>(res);
}

/**
 * Submit one answer; the API returns the re-evaluated step + projection.
 * `stepIndex` carries the caller's committed cursor so the response renders that
 * step (never advancing away from it as a side effect of answering, ADR-28).
 */
export async function submitAnswer(
  sessionId: string,
  token: string,
  questionId: string,
  value: unknown,
  stepIndex?: number,
): Promise<StepResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/answers",
    `${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/answers${stepQuery(stepIndex)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ questionId, value }),
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<StepResponse>(res);
}

/** Submit the session; the API returns the receipt (submittedAt + contentHash). */
export async function submitSession(
  sessionId: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<SubmitResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/submit",
    `${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/submit`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<SubmitResponse>(res);
}

/**
 * Submit a whole step's answers in one request (task 073, Q20, ADR-43).
 *
 * One request, one session lock, one flow evaluation, instead of one call per answer:
 * nine passengers times six questions is fifty-four sequential round trips and
 * fifty-four advisory locks for one Continue. The API refuses entries individually and
 * lists them in `rejected`, so a mistyped cell does not lose the other fifty-three,
 * and it spends the per-session answer allowance **per entry** rather than per request
 * (SEC-16), so a 429 here means the batch did not fit the window and nothing was
 * applied.
 *
 * The answer key rides as `{questionId, instanceId?}` rather than as the joined
 * `ins_7k2/q_plate` string: the join is the RENDERER's encoding of one field's
 * identity, and the API's own vocabulary is the pair. Splitting it here is the one
 * place the BFF touches the encoding, and it is a transport mapping rather than a
 * judgement (R2).
 */
export async function batchAnswers(
  sessionId: string,
  token: string,
  answers: readonly BatchAnswerEntry[],
  stepIndex?: number,
): Promise<BatchAnswerResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/answers/batch",
    `${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/answers/batch${stepQuery(stepIndex)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ answers }),
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<BatchAnswerResponse>(res);
}

/**
 * Add or remove one instance of a repeating group (task 073, ADR-43).
 *
 * **It commits no answers.** The typed values ride the step POST and reach the ledger
 * only on Continue, under the ordinary validation an ordinary Continue does.
 *
 * `opToken` is the one-time operation token the rendered page minted. The API records
 * it with the roster row, so a replayed post applies nothing and comes back
 * `replayed: true` with the roster as it stands.
 */
export async function rosterOp(
  sessionId: string,
  token: string,
  body: {
    readonly op: "add" | "remove";
    readonly groupId: string;
    readonly instanceId?: string;
    readonly opToken: string;
  },
  stepIndex?: number,
): Promise<RosterOpResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/roster",
    `${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/roster${stepQuery(stepIndex)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<RosterOpResponse>(res);
}
