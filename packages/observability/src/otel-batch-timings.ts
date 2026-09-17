/**
 * Batch export timings, resolved from the standard `OTEL_*` variables (issue #901).
 *
 * The OpenTelemetry specification gives every batch processor four environment knobs
 * (`OTEL_BSP_*` for spans, `OTEL_BLRP_*` for log records), and in OpenTelemetry JS 1.x
 * the processor constructors read them. In 2.x they do not. The env fallbacks were
 * moved into the compatibility shims that `@opentelemetry/sdk-trace-base` re-exports,
 * so the constructor reached by `import { BatchSpanProcessor } from
 * "@opentelemetry/sdk-trace"` applies the library defaults and ignores the
 * environment, and `@opentelemetry/sdk-logs` publishes no such shim at all: its
 * `BatchLogRecordProcessor` has no env-reading path in any 2.x release.
 *
 * That silence is what issue #901 is about. The browser harness sets
 * `OTEL_BSP_SCHEDULE_DELAY=500` and has since task 054, so every comment and every
 * poll budget in the suite was written as though exported telemetry arrived in about
 * half a second. For the processors the services construct themselves, it did not.
 * Measured on this branch before the fix, a log record correlated to one admin request
 * reached the in-test receiver 1.1 s to 4.0 s after the request completed, and the
 * dominant term was the API's span batch sitting on the library default of 5 s rather
 * than the 500 ms the harness asked for. (The portal's and the admin's span batches
 * come from `@vercel/otel`'s `"auto"` processor, which bundles an env-reading copy of
 * its own, so those two were already prompt. The gap was every log pipeline and the
 * API's spans.) Nothing failed loudly; the spec's 20 s poll simply had a fraction of
 * the margin its author believed it had, and under CI contention it expired twice in
 * one week.
 *
 * So the values are resolved here, explicitly, and passed to each processor as
 * options. Two properties follow that a shim could not give us. The resolution is one
 * unit-testable function rather than three constructor call sites, and the numbers the
 * processors actually run with are numbers a test can read, which is what lets the
 * browser harness derive a delivery budget from its own configuration instead of
 * guessing a literal.
 *
 * The defaults below are the specification's, which are also the values the 2.x
 * constructors apply when given no options, so a deployment that sets nothing keeps
 * exactly the behaviour it had before this module existed.
 */

/** The environment view these resolvers read. No ambient `process.env` access. */
export type BatchTimingEnv = Record<string, string | undefined>;

/** What a batch processor needs to know about when to export. */
export interface BatchExportTimings {
  /** How long a processor waits before exporting a non-empty buffer. */
  readonly scheduledDelayMillis: number;
  /** How long one export attempt may run before the processor abandons it. */
  readonly exportTimeoutMillis: number;
}

/**
 * The specification defaults for the span pipeline: `OTEL_BSP_SCHEDULE_DELAY` is 5000
 * and `OTEL_BSP_EXPORT_TIMEOUT` is 30000. `@opentelemetry/sdk-trace` 2.11 applies the
 * same two numbers when constructed without options.
 */
const SPAN_DEFAULTS: BatchExportTimings = {
  scheduledDelayMillis: 5_000,
  exportTimeoutMillis: 30_000,
};

/**
 * The specification defaults for the log pipeline: `OTEL_BLRP_SCHEDULE_DELAY` is 1000
 * and `OTEL_BLRP_EXPORT_TIMEOUT` is 30000. `@opentelemetry/sdk-logs` 0.222 applies the
 * same two numbers when constructed without options.
 */
const LOG_DEFAULTS: BatchExportTimings = {
  scheduledDelayMillis: 1_000,
  exportTimeoutMillis: 30_000,
};

/**
 * One variable, or the default when it is absent or not a positive whole number of
 * milliseconds.
 *
 * Deliberately strict and deliberately silent. Strict, because `parseInt` would read
 * `"500ms"` as 500 and `"1e4"` as 1, turning a typo into a plausible-looking timing
 * nobody would question. Silent, because telemetry configuration must never be able to
 * stop a process from serving: a rejected value falls back to the documented default,
 * which is the same behaviour the SDK gives an unset variable.
 *
 * **`0` is refused, and that is one deliberate divergence from the `sdk-trace-base`
 * shim, which applies it.** A zero delay does not schedule an export sooner, it stops
 * batching: the processor arms `setTimeout(..., 0)`, so it exports on the next tick and
 * each record, or the few that happen to share one tick, leaves in an export request of
 * its own. Over a network exporter that is a different component
 * (`SimpleLogRecordProcessor`, which this repository never constructs) rather than a
 * tuning of this one, and arriving at it by way of a delay knob would be a surprise a
 * running deployment absorbs silently. `docs/operations.md` records the floor, so an
 * operator who wants per-record export reads why they cannot get it this way rather
 * than wondering why nothing changed.
 */
function millis(env: BatchTimingEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || !/^\d+$/u.test(raw)) return fallback;
  const value = Number(raw);
  return value > 0 ? value : fallback;
}

/** Span batch timings from `OTEL_BSP_SCHEDULE_DELAY` and `OTEL_BSP_EXPORT_TIMEOUT`. */
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

/**
 * Log-record batch timings from `OTEL_BLRP_SCHEDULE_DELAY` and
 * `OTEL_BLRP_EXPORT_TIMEOUT`.
 */
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
