/** Run cookie and placeholder guards before registering telemetry or serving requests. */

import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { allowlistingLogRecordProcessor } from "@roonga/qcms-observability/logs";
import { batchLogExportTimings } from "@roonga/qcms-observability/otel";
import { registerOTel } from "@vercel/otel";

import {
  assertLocaleConfigured,
  assertNoPlaceholderSecrets,
  assertSecureCookiesConfigured,
} from "./lib/server/config";
import { redactingSpanProcessor } from "./lib/server/telemetry-redaction";

export const DEFAULT_SERVICE_NAME = "qcms-admin";

function apiOrigin(): string | undefined {
  const base = process.env.QCMS_API_BASE_URL?.trim();
  if (base === undefined || base === "") return undefined;
  try {
    return new URL(base).origin;
  } catch {
    return undefined;
  }
}

/** Exit nonzero because Next catches hook throws and otherwise leaves a listener returning 500. Keep Node streams behind NEXT_RUNTIME so the edge compiler drops them; edge failures must still rethrow. */
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
  if (endpoint === undefined || endpoint === "") return;
  const origin = apiOrigin();
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    spanProcessors: [redactingSpanProcessor(), "auto"],
    logRecordProcessors: [
      allowlistingLogRecordProcessor(),
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
        /** The SDK constructor does not read these OTel environment settings itself. */
        ...batchLogExportTimings(process.env),
      }),
    ],
    instrumentations: ["auto"],
    instrumentationConfig: {
      fetch: {
        ...(origin === undefined ? {} : { propagateContextUrls: [origin] }),
      },
    },
  });
}
