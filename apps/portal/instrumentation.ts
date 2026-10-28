/**
 * Portal OpenTelemetry registration (ADR-34).
 *
 * Do not add fetch or undici instrumentation here: Next already emits a span for
 * every server-side fetch and `@vercel/otel` propagates context on it, so a second
 * one double-instruments the BFF hop.
 */

import { registerOTel } from "@vercel/otel";
import { allowlistingLogRecordProcessor } from "@roonga/qcms-observability/logs";
import { batchLogExportTimings } from "@roonga/qcms-observability/otel";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

import {
  assertLocaleConfigured,
  assertNoPlaceholderSecrets,
  assertSecureCookiesConfigured,
} from "./lib/server/config";
import { redactingSpanProcessor } from "./lib/server/telemetry-redaction";

export const DEFAULT_SERVICE_NAME = "qcms-portal";

/**
 * Read directly rather than through `apiBaseUrl()`, which throws when the variable
 * is missing: `register()` runs at process start, where tracing being off is a
 * better outcome than a crash before the app can report anything.
 */
function apiOrigin(): string | undefined {
  const base = process.env.QCMS_API_BASE_URL?.trim();
  if (base === undefined || base === "") return undefined;
  try {
    return new URL(base).origin;
  } catch {
    return undefined;
  }
}

/**
 * Refuse to start on a configuration this process must not serve.
 *
 * Exiting rather than only throwing is load-bearing: Next catches an error from this
 * hook and leaves a process listening that answers every request with a 500, which
 * reads as "running" to an operator because neither app has a Compose healthcheck.
 *
 * `process.exit` and `process.stderr` are absent on Next's edge runtime, which loads
 * this hook too, hence the guards. The `NEXT_RUNTIME` check is about compilation, not
 * the call: Turbopack compiles this file for the edge target, where a bare
 * `process.stderr` reference fails to build, and Next substitutes a literal for that
 * variable so the edge bundle drops the branch entirely.
 *
 * The twin is `apps/admin/instrumentation.ts`. Change one, change the other.
 */
function refuseUnsafeConfiguration(): void {
  try {
    assertSecureCookiesConfigured();
    assertNoPlaceholderSecrets();
    assertLocaleConfigured();
  } catch (error) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      process.stderr?.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (typeof process.exit === "function") process.exit(1);
    throw error;
  }
}

export function register(): void {
  refuseUnsafeConfiguration();

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  // Unconfigured must mean off: the OTLP exporter's own default endpoint is
  // `http://localhost:4318`, so registering would export to nobody on every request.
  if (endpoint === undefined || endpoint === "") return;

  const origin = apiOrigin();

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    // SEC-13 redaction runs before the environment's exporter.
    spanProcessors: [redactingSpanProcessor(), "auto"],
    logRecordProcessors: [
      allowlistingLogRecordProcessor(),
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
        // This constructor does not read `OTEL_BLRP_*` for itself.
        ...batchLogExportTimings(process.env),
      }),
    ],
    instrumentations: ["auto"],
    instrumentationConfig: {
      fetch: {
        // `@vercel/otel` injects `traceparent` only into fetches whose URL matches this
        // list, so without the API origin the BFF hop becomes a second, unlinked trace.
        ...(origin === undefined ? {} : { propagateContextUrls: [origin] }),
      },
    },
  });
}
