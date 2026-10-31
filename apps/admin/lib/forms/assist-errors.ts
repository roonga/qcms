import { t, type MessageKey } from "../i18n/en.ts";

import type { AssistErrorCode } from "./assist-stream.ts";

/**
 * What a failed turn says. The API's own error codes, plus the states this app derives for
 * itself: a tool call it refused, and the HTTP answers the route gives before any event
 * streams. One resolver, so a code the conversation cannot render is a type error rather
 * than a blank alert.
 */
export type AssistErrorKind =
  AssistErrorCode | "TOOL_REJECTED" | "RATE_LIMITED" | "STALE_DRAFT" | "HTTP";

export interface AssistError {
  readonly kind: AssistErrorKind;
  readonly message?: string;
  readonly tool?: string;
  readonly retryAfter?: string;
}

/** The kinds whose sentence needs no interpolation, keyed to the catalog. */
const SIMPLE_ERROR_MESSAGES: Readonly<
  Record<Exclude<AssistErrorKind, "REFUSED" | "TOOL_REJECTED" | "RATE_LIMITED" | "HTTP">, MessageKey>
> = {
  PROVIDER_ERROR: "forms.assist.error.PROVIDER_ERROR",
  PROVIDER_REJECTED: "forms.assist.error.PROVIDER_REJECTED",
  NO_PROPOSAL: "forms.assist.error.NO_PROPOSAL",
  LENGTH: "forms.assist.error.LENGTH",
  STEP_LIMIT: "forms.assist.error.STEP_LIMIT",
  STALE_DRAFT: "forms.assist.error.STALE_DRAFT",
};

export function messageForError(error: AssistError): string {
  if (error.kind === "REFUSED") {
    return t("forms.assist.error.REFUSED", { message: error.message ?? "" });
  }
  if (error.kind === "TOOL_REJECTED") {
    return t("forms.assist.error.TOOL_REJECTED", { tool: error.tool ?? "" });
  }
  if (error.kind === "RATE_LIMITED") {
    return error.retryAfter === undefined
      ? t("forms.assist.error.RATE_LIMITED")
      : t("forms.assist.error.RATE_LIMITED_RETRY", { seconds: error.retryAfter });
  }
  if (error.kind === "HTTP") {
    return t("forms.assist.error.HTTP", { message: error.message ?? "" });
  }
  return t(SIMPLE_ERROR_MESSAGES[error.kind]);
}

/** The HTTP-level failures the route relays as-is: 429, 409, and everything else. */
export async function errorForResponse(response: Response): Promise<AssistError> {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return retryAfter === null ? { kind: "RATE_LIMITED" } : { kind: "RATE_LIMITED", retryAfter };
  }
  if (response.status === 409) return { kind: "STALE_DRAFT" };
  const body: unknown = await response.json().catch(() => undefined);
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return { kind: "HTTP", message: typeof message === "string" ? message : String(response.status) };
}
