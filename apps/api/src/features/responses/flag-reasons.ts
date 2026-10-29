/** Persisted in `submissions.flagged_reason`, so the values must stay stable. */
export const FlagReason = {
  HONEYPOT: "HONEYPOT",
  MIN_TIME: "MIN_TIME",
  RATE_ANOMALY: "RATE_ANOMALY",
} as const;

export type FlagReason = (typeof FlagReason)[keyof typeof FlagReason];

export const FLAG_REASONS: readonly FlagReason[] = Object.values(FlagReason);
