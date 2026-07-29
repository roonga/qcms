/**
 * OpenTelemetry bootstrap for the API (task 054, ADR-34).
 *
 * The canonical `NodeSDK` setup from the OTel JS docs, at the one place a
 * composition root may do this kind of thing: the process entry. Nothing else in
 * `apps/api` starts, configures, or shuts down an SDK, and `@qcms/core` never
 * sees OpenTelemetry at all.
 *
 * **The gate is ours, not the exporter's.** With `OTEL_EXPORTER_OTLP_ENDPOINT`
 * unset, `startTelemetry` returns a disabled handle having imported nothing: no
 * SDK, no instrumentation patching, no exporter. That has to be an explicit
 * check, because the OTLP exporter's own default is to POST to
 * `http://localhost:4318` - a default which, with nothing listening, turns every
 * flush into a connection error (an unhandled `ECONNREFUSED` in a plain Node
 * process). Telemetry off means off.
 *
 * **Ordering matters and is why this module imports nothing of ours.** The
 * instrumentations patch their targets when those modules are first `require`d,
 * so the SDK must start before `pg`, `pino`, `undici` or the app graph loads.
 * `serve.ts` therefore starts telemetry first and only then dynamically imports
 * `main.js`. A static `import` of the app from here would defeat that by hoisting.
 *
 * Instrumentations are an **explicit list** of official packages - http, undici
 * (outbound webhook delivery), pg, pino. Not `auto-instrumentations-node`: same
 * code, 100+ packages of dependency surface. Server spans come from `@hono/otel`
 * at the app level (`app.ts`), which is also what extracts the inbound
 * `traceparent` from the portal's BFF hop.
 */

import { redactingSpanProcessor } from "./telemetry-redaction.js";

/** The service name reported when `OTEL_SERVICE_NAME` is not set. */
export const DEFAULT_SERVICE_NAME = "qcms-api";

/** A minimal environment view, so tests need no `process.env` mutation. */
export type TelemetryEnv = Record<string, string | undefined>;

export interface TelemetryOptions {
  /**
   * Environment to read the standard `OTEL_*` knobs from; defaults to
   * `process.env`. An explicit record is what lets the e2e harness point one
   * in-process API at its own receiver and service name without touching the
   * ambient environment of the whole test run.
   */
  readonly env?: TelemetryEnv;
}

/** The started (or deliberately-not-started) telemetry handle. */
export interface Telemetry {
  /** True only when an SDK is running and exporting. */
  readonly enabled: boolean;
  /** Flush and stop; a no-op when disabled. Safe to call once, on shutdown. */
  shutdown(): Promise<void>;
}

const DISABLED: Telemetry = {
  enabled: false,
  shutdown: () => Promise.resolve(),
};

/**
 * The configured OTLP base endpoint, or `undefined` when tracing is off.
 *
 * Deliberately ONE switch: the signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
 * does not enable tracing by itself (it still overrides the trace URL once tracing
 * is on, inside the exporter), so there is exactly one variable to reason about
 * when asking "is this process exporting telemetry".
 */
export function otlpEndpoint(env: TelemetryEnv): string | undefined {
  let raw = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (raw === undefined || raw === "") return undefined;
  // Trailing slashes trimmed one at a time rather than with `/\/+$/`, which is
  // super-linear on a pathological input (`sonarjs/super-linear-regex`) - and this
  // reads an environment variable, so "pathological" is not ours to rule out.
  while (raw.endsWith("/")) raw = raw.slice(0, -1);
  return raw;
}

/**
 * Start tracing when configured; otherwise do nothing at all.
 *
 * Async because every OTel import is deferred into the enabled branch: with
 * tracing off, none of the SDK, exporter or instrumentation packages is even
 * loaded, so the disabled path costs one environment read.
 */
export async function startTelemetry(options: TelemetryOptions = {}): Promise<Telemetry> {
  const env = options.env ?? process.env;
  const endpoint = otlpEndpoint(env);
  if (endpoint === undefined) return DISABLED;

  const [
    { NodeSDK },
    { BatchSpanProcessor },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { UndiciInstrumentation },
    { PgInstrumentation },
    { PinoInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-pino"),
  ]);

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    // SEC-13 first, exporter second: the allowlist runs before the batch
    // processor queues anything.
    spanProcessors: [
      redactingSpanProcessor(),
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      }),
    ],
    instrumentations: [
      new HttpInstrumentation(),
      // Outbound webhook delivery (025) runs on fetch/undici.
      new UndiciInstrumentation(),
      // `enhancedDatabaseReporting` off (its default) is the SEC-13 requirement:
      // parameterized statement text may be recorded, bound parameter VALUES may
      // not - an answer value is a bound parameter on every insert.
      new PgInstrumentation({
        enhancedDatabaseReporting: false,
        addSqlCommenterCommentToQueries: false,
      }),
      // Log correlation only. `disableLogSending` keeps the OTel Logs pipeline out
      // of the baseline (ADR-34 defers OTLP log export to Phase 4); stdout JSON
      // stays the transport, now carrying `trace_id`/`span_id`.
      new PinoInstrumentation({ disableLogSending: true }),
    ],
  });

  sdk.start();
  return {
    enabled: true,
    shutdown: () => sdk.shutdown(),
  };
}
