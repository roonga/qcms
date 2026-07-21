import { INTERNAL_TOKEN_HEADER, apiBaseUrl, internalToken } from "./config";

/**
 * The strict BFF's internal API client (task 029, R2).
 *
 * This module is proxy + credential duty ONLY: it attaches the SEC-4 internal
 * token and (when present) the respondent's session bearer, forwards the call to
 * the server-only internal API, and returns the parsed JSON. It performs NO rule
 * evaluation and NO validation authority - the API owns all of that (R2). It
 * imports nothing from @qcms/core (enforced by the import-surface test); the
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

/** GET /sessions/:id/step and POST /sessions/:id/answers both return this shape. */
export interface StepResponse {
  readonly step: ApiStepDocument | null;
  readonly a2uiSpecVersion: string;
  readonly flowState: ApiFlowState;
  readonly progress: ApiProgress;
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

function baseHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [INTERNAL_TOKEN_HEADER]: internalToken(),
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
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

type StartBody = { readonly formSlug: string } | { readonly token: string };

/** Start a session: anonymous (`{ formSlug }`) or secure-link (`{ token }`). */
export async function startSession(
  body: StartBody & { readonly challengeToken?: string },
): Promise<StartSessionResponse> {
  const res = await fetch(`${apiBaseUrl()}/sessions`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return readJson<StartSessionResponse>(res);
}

/** Fetch the current step + flow projection for a session (bearer required). */
export async function getStep(sessionId: string, token: string): Promise<StepResponse> {
  const res = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/step`, {
    headers: baseHeaders(token),
    cache: "no-store",
  });
  return readJson<StepResponse>(res);
}

/** Submit one answer; the API returns the re-evaluated step + projection. */
export async function submitAnswer(
  sessionId: string,
  token: string,
  questionId: string,
  value: unknown,
): Promise<StepResponse> {
  const res = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/answers`, {
    method: "POST",
    headers: baseHeaders(token),
    body: JSON.stringify({ questionId, value }),
    cache: "no-store",
  });
  return readJson<StepResponse>(res);
}

/** Submit the session; the API returns the receipt (submittedAt + contentHash). */
export async function submitSession(
  sessionId: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<SubmitResponse> {
  const res = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    headers: baseHeaders(token),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return readJson<SubmitResponse>(res);
}
