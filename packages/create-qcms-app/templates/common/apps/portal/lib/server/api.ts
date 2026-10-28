import type { A2UIAnswerValue } from "@roonga/qcms-ui";

import { CLIENT_ADDRESS_HEADER, currentClientAddress } from "./client-address";
import { INTERNAL_TOKEN_HEADER, apiBaseUrl, internalToken } from "./config";
import { currentEnvironment, environmentPrefix } from "./environment";
import { REQUEST_ID_HEADER, currentRequestId } from "./request-id";
import { serverLogger } from "./logger";

import { splitFieldKey } from "../repeat";

/**
 * The strict BFF's internal API client: proxy and credential duty only. It performs no
 * rule evaluation and holds no validation authority (R2), and imports nothing from
 * `@roonga/qcms-core`, so the types below are structural mirrors of the API's response
 * shapes rather than kernel imports.
 *
 * Every call goes to the request's own environment's API surface (ADR-40, Q21), through
 * {@link apiPath} and nothing else, so no call can forget the prefix: there is no
 * unprefixed path composed anywhere below.
 *
 * The environment is not sent as a header. A respondent request's environment is the
 * group that served it, which is what makes the absence of a non-prod anonymous door a
 * routing fact rather than a handler's good manners (SEC-14).
 */

/** Served verbatim (ADR-18); `null` when the flow is complete. */
export interface ApiStepDocument {
  readonly stepId: string;
  readonly root: unknown;
}

/** The API's forward-pass projection, never re-derived here. */
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
 * How stored answers reach the browser without the compiled document carrying them
 * (ADR-18): they ride beside `step`, which stays the content-only bytes the API serves
 * verbatim. A question with no current answer, including one whose newest ledger row is
 * a retraction, is absent.
 */
export type ApiHeldValues = Readonly<Record<string, A2UIAnswerValue>>;

/**
 * One repeating group's live instances, already derived and truncated by the API, in
 * roster order (ADR-42). A compiled `RepeatGroup` is a template carrying its member
 * controls once, because the compiler is answer-blind and an instance count is
 * answer-dependent, so the roster travels beside the document as the values do.
 */
export interface ApiGroupRoster {
  readonly groupId: string;
  readonly instances: readonly string[];
}

/**
 * A `perInstanceStep` group paginates one step into one page per live instance, so the
 * cursor indexes views rather than steps and the response has to say which view it is
 * (ADR-28 as amended, Q22). Both keys are `null` for every other page.
 */
export interface ApiStepView {
  readonly groupId: string | null;
  readonly instanceId: string | null;
}

/** GET /sessions/:id/step and POST /sessions/:id/answers both return this shape. */
export interface StepResponse {
  readonly step: ApiStepDocument | null;
  readonly values: ApiHeldValues;
  readonly a2uiSpecVersion: string;
  readonly flowState: ApiFlowState;
  readonly rosters: readonly ApiGroupRoster[];
  readonly view: ApiStepView;
  readonly progress: ApiProgress;
}

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

export interface BatchAnswerResponse extends StepResponse {
  readonly rejected: readonly BatchRejection[];
}

export interface RosterOpResponse extends StepResponse {
  /** True when the one-time token had already been spent, so nothing was written. */
  readonly replayed: boolean;
  readonly minted: readonly string[];
}

export interface StartSessionResponse {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly formVersion: number;
  readonly expiresAt: string;
}

export interface SubmitResponse {
  readonly submittedAt: string;
  readonly contentHash: string;
}

/** The API's uniform error envelope. */
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
 * Credential and correlation headers for one internal API call. `traceparent` rides the
 * same fetch without appearing here, injected by `@vercel/otel`.
 *
 * The raw `x-forwarded-for` is not forwarded: `client-address.ts` resolves it here,
 * where the number of trusted proxies is known, and vouches for the result on a header
 * the SEC-4 channel protects. With no trustworthy address the header is omitted and the
 * API falls back to its shared bucket.
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

/**
 * `path` is the API's own unprefixed path, exactly as the OpenAPI document declares it,
 * and the environment's prefix is prepended here. `prod` adds nothing.
 */
async function apiPath(path: string): Promise<string> {
  return `${apiBaseUrl()}${environmentPrefix(await currentEnvironment())}${path}`;
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

/**
 * The API mounts this endpoint on `prod`'s respondent surface only (SEC-14), and the
 * portal serves `/f/{slug}` under no prefix and on no reserved host, so it is never
 * called for a non-prod environment. If it were, the answer would be a 404 rather than a
 * refusal, which is the point of the split.
 */
export async function startAnonymousSession(body: {
  readonly formSlug: string;
  readonly challengeToken?: string;
}): Promise<StartSessionResponse> {
  const headers = await baseHeaders();
  const res = await loggedFetch(
    "/sessions",
    await apiPath("/sessions"),
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
 * On every environment's respondent surface, because a secure link is how a non-prod
 * environment is reached at all (ADR-40). The environment is not in the token and is not
 * sent: the address this call is made at names it, and the API refuses a token whose row
 * names another one (Q21).
 */
export async function startLinkSession(body: {
  readonly token: string;
  readonly challengeToken?: string;
}): Promise<StartSessionResponse> {
  const headers = await baseHeaders();
  const res = await loggedFetch(
    "/sessions/link",
    await apiPath("/sessions/link"),
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

/** ADR-28's explicit navigation cursor, absent for the first-incomplete default. */
function stepQuery(stepIndex?: number): string {
  return stepIndex === undefined ? "" : `?step=${encodeURIComponent(String(stepIndex))}`;
}

/** Omit `stepIndex` to serve the first incomplete step. */
export async function getStep(
  sessionId: string,
  token: string,
  stepIndex?: number,
): Promise<StepResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/step",
    await apiPath(`/sessions/${encodeURIComponent(sessionId)}/step${stepQuery(stepIndex)}`),
    {
      headers,
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<StepResponse>(res);
}

/**
 * `stepIndex` carries the caller's committed cursor, so the response renders that step
 * rather than advancing as a side effect of answering (ADR-28).
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
    await apiPath(`/sessions/${encodeURIComponent(sessionId)}/answers${stepQuery(stepIndex)}`),
    {
      method: "POST",
      headers,
      // The qualified name is taken apart here, at the one boundary that cares: above
      // this call a field is `instanceId/questionId` throughout (Q15), and the API takes
      // the two parts separately.
      body: JSON.stringify({ ...splitFieldKey(questionId), value }),
      cache: "no-store",
    },
    headers[REQUEST_ID_HEADER],
  );
  return readJson<StepResponse>(res);
}

export async function submitSession(
  sessionId: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<SubmitResponse> {
  const headers = await baseHeaders(token);
  const res = await loggedFetch(
    "/sessions/:sessionId/submit",
    await apiPath(`/sessions/${encodeURIComponent(sessionId)}/submit`),
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
 * One request, one session lock, one flow evaluation, instead of one call per answer,
 * which is what makes a repeating group's Continue affordable (ADR-43). The API refuses
 * entries individually and lists them in `rejected`, and it spends the answer allowance
 * per entry rather than per request (SEC-16), so a 429 means nothing was applied.
 *
 * The answer key rides as a pair rather than the joined string: the join is the
 * renderer's encoding and the pair is the API's vocabulary, so splitting it is a
 * transport mapping rather than a judgement (R2).
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
    await apiPath(
      `/sessions/${encodeURIComponent(sessionId)}/answers/batch${stepQuery(stepIndex)}`,
    ),
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
 * Commits no answers: the typed values ride the step POST and reach the ledger only on
 * Continue (ADR-43). The API records `opToken` with the roster row, so a replayed post
 * applies nothing and comes back `replayed: true`.
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
    await apiPath(`/sessions/${encodeURIComponent(sessionId)}/roster${stepQuery(stepIndex)}`),
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
