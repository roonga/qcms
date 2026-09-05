/**
 * Admin server-process registration (issue #292).
 *
 * Next's documented startup hook: a root `instrumentation.ts` exporting `register()`,
 * which Next calls once per server process before anything serves. That makes it the
 * only place in a Next app where "refuse to boot" can mean boot rather than "500 on the
 * first request", which is why the cookie-security guard is called from here.
 *
 * The portal's twin (`apps/portal/instrumentation.ts`) follows the same cookie guard,
 * tracing, propagation and safe-log recipe. Registration belongs here, after the guard.
 */

import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { allowlistingLogRecordProcessor } from "@roonga/qcms-observability/logs";
import { registerOTel } from "@vercel/otel";

import { assertNoPlaceholderSecrets, assertSecureCookiesConfigured } from "./lib/server/config";
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

/**
 * Refuse to start on a configuration this process must not serve.
 *
 * Two refusals, both boot-time and both fatal: a cookie policy a browser will not
 * protect (issue #292) and a secret still holding an example-file placeholder
 * (issue #491). Their reasoning lives beside each assertion in `lib/server/config.ts`.
 *
 * **Exiting rather than only throwing is load-bearing**: Next catches an error from this
 * hook, reports `Failed to prepare server`, and then leaves a process listening that
 * answers every request with a 500. Nothing is served and no cookie is ever set, so the
 * security property holds either way, but neither app has a Compose healthcheck, so that
 * process reads as "running" to an operator and to `docker compose ps`. A non-zero exit is
 * the same refusal made visible: the container dies, `restart: unless-stopped` restarts
 * it, and the message is the last thing in `docker logs`.
 *
 * The guard on `process.exit` is for Next's edge runtime, which loads this hook too and
 * has no such function. Neither app runs anything on the edge runtime today; if one ever
 * does, it re-throws and gets the 500-on-everything behaviour instead of a `TypeError`
 * that hides the real message. `process.stderr` can be absent in that sandbox for the
 * same reason, so the write is optional-called: a missing stream must not become the
 * exception that swallows a refusal an operator needs to read.
 *
 * The twin is `apps/portal/instrumentation.ts`. **Change one, change the other.**
 */
function refuseUnsafeConfiguration(): void {
  try {
    assertSecureCookiesConfigured();
    // Second because the cookie refusal is the older one and its message is the one an
    // operator following `.env.compose.example` is most likely to need. Both are boot
    // refusals with the same exit shape, so a deployment carrying both defects sees the
    // first, fixes it, and is told about the second on the next start.
    assertNoPlaceholderSecrets();
  } catch (error) {
    process.stderr?.write(`${error instanceof Error ? error.message : String(error)}\n`);
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
