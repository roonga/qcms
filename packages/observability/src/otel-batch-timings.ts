/**
 * Batch export timings, resolved from the standard `OTEL_*` variables.
 *
 * The OpenTelemetry 2.x processor constructors do not read those variables: the
 * span env fallbacks live in compatibility shims the published constructor does
 * not reach, and `@opentelemetry/sdk-logs` publishes no such shim at all. So a
 * deployment that sets a schedule delay silently gets the library default, which
 * is what made the browser suite's poll budgets a fraction of what they looked.
 *
 * Resolving the values here and passing them as options makes the resolution one
 * unit-testable function rather than three constructor call sites, and makes the
 * numbers readable, which is what lets the browser harness derive a delivery
 * budget from its own configuration rather than guess a literal.
 *
 * The defaults below are the specification's, which are also what the 2.x
 * constructors apply when given no options, so a deployment that sets nothing
 * keeps the behaviour it had.
 */

/** No ambient `process.env` access: the environment is passed in. */
export type BatchTimingEnv = Record<string, string | undefined>;

export interface BatchExportTimings {
  /** How long a processor waits before exporting a non-empty buffer. */
  readonly scheduledDelayMillis: number;
  /** How long one export attempt may run before it is abandoned. */
  readonly exportTimeoutMillis: number;
}

/** The specification defaults for the span pipeline. */
const SPAN_DEFAULTS: BatchExportTimings = {
  scheduledDelayMillis: 5_000,
  exportTimeoutMillis: 30_000,
};

/** The specification defaults for the log pipeline. */
const LOG_DEFAULTS: BatchExportTimings = {
  scheduledDelayMillis: 1_000,
  exportTimeoutMillis: 30_000,
};

/**
 * One variable, or the default when it is absent or not a positive whole number
 * of milliseconds.
 *
 * Strict, because `parseInt` would read `"500ms"` as 500 and turn a typo into a
 * plausible-looking timing nobody would question. Silent, because telemetry
 * configuration must never stop a process from serving, so a rejected value
 * falls back to the documented default.
 *
 * Zero is refused, which diverges from the upstream shim. A zero delay does not
 * export sooner, it stops batching, so each record leaves in a request of its
 * own, which is a different processor rather than a tuning of this one.
 * `docs/operations.md` records the floor.
 */
function millis(env: BatchTimingEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || !/^\d+$/u.test(raw)) return fallback;
  const value = Number(raw);
  return value > 0 ? value : fallback;
}

export function batchSpanExportTimings(env: BatchTimingEnv): BatchExportTimings {
  return {
    scheduledDelayMillis: millis(
      env,
      "OTEL_BSP_SCHEDULE_DELAY",
      SPAN_DEFAULTS.scheduledDelayMillis,
    ),
    exportTimeoutMillis: millis(env, "OTEL_BSP_EXPORT_TIMEOUT", SPAN_DEFAULTS.exportTimeoutMillis),
  };
}

export function batchLogExportTimings(env: BatchTimingEnv): BatchExportTimings {
  return {
    scheduledDelayMillis: millis(
      env,
      "OTEL_BLRP_SCHEDULE_DELAY",
      LOG_DEFAULTS.scheduledDelayMillis,
    ),
    exportTimeoutMillis: millis(env, "OTEL_BLRP_EXPORT_TIMEOUT", LOG_DEFAULTS.exportTimeoutMillis),
  };
}
