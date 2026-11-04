/** Require exact, case-sensitive session-ID confirmation after trimming to put deliberate effort before irreversible erasure. */

export function isErasureConfirmed(typed: string, sessionId: string): boolean {
  if (sessionId === "") return false;
  return typed.trim() === sessionId;
}

/** Use closed reason codes so permanent compliance records cannot accumulate respondent names or incomparable free text. */
export const ERASURE_REASONS = ["subject_request", "retention_policy", "operator_error"] as const;

export type ErasureReason = (typeof ERASURE_REASONS)[number];

export const DEFAULT_ERASURE_REASON: ErasureReason = "subject_request";

export function isErasureReason(value: string): value is ErasureReason {
  return (ERASURE_REASONS as readonly string[]).includes(value);
}
