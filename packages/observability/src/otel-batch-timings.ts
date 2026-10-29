/**
 * Batch export timings, resolved from the standard `OTEL_*` variables, which the
 * OpenTelemetry 2.x processor constructors do not read: a deployment that sets a
 * schedule delay otherwise gets the library default silently. The defaults below
 * are the specification's, so a deployment that sets nothing is unaffected.
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
 * One variable, or the default when absent or not a positive whole number of milliseconds.
 * Strict (`parseInt` reads `"500ms"` as 500) and silent. Zero is refused: it stops batching.
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
