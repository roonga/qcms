/**
 * Anti-abuse flag vocabulary (task 026, finalized with 020/023).
 *
 * A flagged submission is stored with the same success-shaped response as a
 * clean one (the tell never leaks) but is withheld from webhook delivery until
 * an admin reviews and releases it (023). The reason string lands in
 * `submissions.flagged_reason` (a free-text column, migration 0005) and is
 * surfaced verbatim in the admin response listing (023), which filters on
 * `flagged_reason is [not] null`.
 *
 * This is the canonical, closed set of reasons. Keep the values stable - they
 * are persisted in the database and shown to operators.
 */
export const FlagReason = {
  /** The honeypot decoy field was filled - an automated form-filler (compiler decoy, 011). */
  HONEYPOT: "HONEYPOT",
  /** The submission arrived faster than the (per-form or global) min-time floor. */
  MIN_TIME: "MIN_TIME",
  /** A rate/velocity anomaly on the session (reserved: a soft signal, distinct from a hard 429). */
  RATE_ANOMALY: "RATE_ANOMALY",
} as const;

/** A persisted anti-abuse flag reason (one of {@link FlagReason}'s values). */
export type FlagReason = (typeof FlagReason)[keyof typeof FlagReason];

/** Every canonical reason value, for enumeration/validation (e.g. 023's listing). */
export const FLAG_REASONS: readonly FlagReason[] = Object.values(FlagReason);
