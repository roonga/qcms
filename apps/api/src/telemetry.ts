/**
 * OpenTelemetry bootstrap for the API (task 054, ADR-34).
 *
 * The canonical `NodeSDK` setup from the OTel JS docs, at the one place a
 * composition root may do this kind of thing: the process entry. Nothing else in
 * `apps/api` starts, configures, or shuts down an SDK, and `@roonga/qcms-core` never
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
 * **Ordering matters and is why this module imports none of the app graph or
 * instrumented libraries.** The shared observability import contains processors
 * only and does not load an instrumentation target. The instrumentations patch
 * their targets when those modules are first `require`d,
 * so the SDK must start before `pg`, `undici` or the app graph loads.
 * `serve.ts` therefore starts telemetry first and only then dynamically imports
 * `main.js`. A static `import` of the app from here would defeat that by hoisting.
 *
 * Instrumentations are an **explicit list** of official packages - http, undici
 * (outbound webhook delivery), pg. Not `auto-instrumentations-node`: same
 * code, 100+ packages of dependency surface. Server spans come from `@hono/otel`
 * at the app level (`app.ts`), which is also what extracts the inbound
 * `traceparent` from the portal's BFF hop.
 */

import { allowlistingLogRecordProcessor } from "@roonga/qcms-observability/logs";
import { SpanKind, type Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace";

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
 * Keep node:http's inbound context bridge but discard its redundant wire span.
 * `@hono/otel` creates the route-aware semantic SERVER span beneath that context;
 * exporting both makes every API request appear twice (#184).
 */
export function suppressDuplicateIncomingHttpSpans(delegate: SpanProcessor): SpanProcessor {
  return {
    onStart(span: Span, parentContext: Context): void {
      delegate.onStart(span, parentContext);
    },
    onEnd(span: ReadableSpan): void {
      if (
        span.kind === SpanKind.SERVER &&
        span.instrumentationScope.name === "@opentelemetry/instrumentation-http"
      ) {
        return;
      }
      delegate.onEnd(span);
    },
    forceFlush: () => delegate.forceFlush(),
    shutdown: () => delegate.shutdown(),
  };
}

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
    { BatchLogRecordProcessor },
    { OTLPLogExporter },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { UndiciInstrumentation },
    { PgInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/exporter-logs-otlp-http"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
    import("@opentelemetry/instrumentation-pg"),
  ]);

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    // SEC-13 first, exporter second: the allowlist runs before the batch
    // processor queues anything.
    spanProcessors: [
      redactingSpanProcessor(),
      suppressDuplicateIncomingHttpSpans(
        new BatchSpanProcessor({
          exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
        }),
      ),
    ],
    // SEC-13 runs before batching: unsafe fields never enter an exporter queue.
    logRecordProcessors: [
      allowlistingLogRecordProcessor(),
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
      }),
    ],
    instrumentations: [
      // The incoming hook creates the propagation context used by the Hono span.
      // The exporting processor above drops only its redundant raw SERVER span.
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
    ],
  });

  sdk.start();
  return {
    enabled: true,
    shutdown: () => sdk.shutdown(),
  };
}
