/**
 * Portal OpenTelemetry registration (task 054, ADR-34).
 *
 * Next's own documented OTel route: a root `instrumentation.ts` exporting
 * `register()`, which Next calls once per server process before anything else
 * runs, and `registerOTel` from `@vercel/otel`. No `NodeSDK` here - the Next guide
 * is explicit that the Node SDK is not edge-compatible, and `@vercel/otel` is the
 * wrapper that works on both runtimes. The portal is server-side by construction
 * anyway (R2's strict BFF), so this file only ever runs on the Node runtime.
 *
 * What is deliberately NOT here:
 *
 * - **No `instrumentation-undici` / fetch instrumentation of our own.** Next
 *   already emits a `fetch <method> <url>` span for every server-side fetch and
 *   `@vercel/otel` already handles context propagation on it. Adding undici
 *   instrumentation would double-instrument the one hop that matters (the BFF
 *   call), producing two client spans per API request.
 * - **No exporter choice.** `"auto"` reads the standard `OTEL_EXPORTER_OTLP_*`
 *   variables, which is the adopter's decision to make (QCMS ships
 *   instrumentation and conventions, never a backend).
 *
 * The gate: with `OTEL_EXPORTER_OTLP_ENDPOINT` unset, `register()` returns without
 * calling `registerOTel` at all. That is ours to enforce, because the OTLP
 * exporter's own default is `http://localhost:4318` - so "not configured" would
 * otherwise mean "export to a port nobody is listening on", on every request, in
 * every default dev run and CI job.
 */

import { registerOTel } from "@vercel/otel";

import { redactingSpanProcessor } from "./lib/server/telemetry-redaction";

/** The service name reported when `OTEL_SERVICE_NAME` is not set. */
export const DEFAULT_SERVICE_NAME = "qcms-portal";

/**
 * The internal API origin, for `propagateContextUrls`.
 *
 * Read directly rather than through `lib/server/config.ts`'s `apiBaseUrl()`,
 * which throws when the variable is missing: `register()` runs at process start,
 * where a missing value must not crash the server before the app can report it
 * (and where tracing being off is a perfectly good outcome).
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

export function register(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (endpoint === undefined || endpoint === "") return;

  const origin = apiOrigin();

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    // SEC-13 first, the environment's exporter second.
    spanProcessors: [redactingSpanProcessor(), "auto"],
    instrumentationConfig: {
      fetch: {
        // `@vercel/otel` injects `traceparent` ONLY into fetches whose URL matches
        // this list (its default is Vercel deployment URLs), so without the API
        // origin here the BFF hop carries no context and the respondent's action
        // becomes two unrelated traces instead of one. This is the single most
        // load-bearing line in the file.
        ...(origin === undefined ? {} : { propagateContextUrls: [origin] }),
      },
    },
  });
}
