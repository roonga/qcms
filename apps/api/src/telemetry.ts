/**
 * The gate is ours: the OTLP exporter defaults to `http://localhost:4318`, so an
 * unconfigured deployment would fail every flush. This module imports no instrumented
 * library, so the SDK starts before `pg`, `undici` or the app graph loads.
 */

import { allowlistingLogRecordProcessor } from "@roonga/qcms-observability/logs";
import { batchLogExportTimings, batchSpanExportTimings } from "@roonga/qcms-observability/otel";
import { SpanKind, type Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace";

import { redactingSpanProcessor } from "./telemetry-redaction.js";

export const DEFAULT_SERVICE_NAME = "qcms-api";

export type TelemetryEnv = Record<string, string | undefined>;

export interface TelemetryOptions {
  /**
   * An explicit record lets the e2e harness point one in-process API at its own receiver
   * without touching the ambient environment of the whole test run.
   */
  readonly env?: TelemetryEnv;
}

export interface Telemetry {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}

const DISABLED: Telemetry = {
  enabled: false,
  shutdown: () => Promise.resolve(),
};

/**
 * Keeps node:http's inbound context bridge but drops its wire span: `@hono/otel` creates
 * the route-aware SERVER span beneath that context, and exporting both shows every
 * request twice.
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
 * One switch deliberately: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` does not enable tracing by
 * itself, so one variable answers "is this process exporting telemetry".
 */
export function otlpEndpoint(env: TelemetryEnv): string | undefined {
  let raw = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (raw === undefined || raw === "") return undefined;
  // One at a time rather than `/\/+$/`, which is super-linear on a pathological input
  // (`sonarjs/super-linear-regex`) that an environment variable can supply.
  while (raw.endsWith("/")) raw = raw.slice(0, -1);
  return raw;
}

/**
 * Async because every OTel import is deferred into the enabled branch: with tracing off,
 * no SDK, exporter or instrumentation package is loaded at all.
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

  // The standard batch knobs are resolved explicitly because these two constructors read
  // no environment of their own.
  const spanTimings = batchSpanExportTimings(env);
  const logTimings = batchLogExportTimings(env);

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    // SEC-13 first: the allowlist runs before the batch processor queues anything.
    spanProcessors: [
      redactingSpanProcessor(),
      suppressDuplicateIncomingHttpSpans(
        new BatchSpanProcessor({
          exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
          ...spanTimings,
        }),
      ),
    ],
    // SEC-13 runs before batching: unsafe fields never enter an exporter queue.
    logRecordProcessors: [
      allowlistingLogRecordProcessor(),
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
        ...logTimings,
      }),
    ],
    instrumentations: [
      // Kept for the propagation context the Hono span needs; only its redundant SERVER
      // span is dropped above.
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      // SEC-13: parameterized statement text may be recorded, bound parameter values may
      // not, and an answer value is a bound parameter on every insert.
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
