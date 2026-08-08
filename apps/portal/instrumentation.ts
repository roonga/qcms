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

import { assertSecureCookiesConfigured } from "./lib/server/config";
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

/**
 * Refuse to start on a cookie configuration a browser will not protect (issue #292).
 *
 * `register()` is the only hook either app has that runs once at boot rather than on
 * a request, so this is where "refuse to boot" lives. **Exiting rather than only
 * throwing is load-bearing**: Next catches an error from this hook, reports
 * `Failed to prepare server`, and then leaves a process listening that answers every
 * request with a 500. Nothing is served and no cookie is ever set, so the security
 * property holds either way, but neither app has a Compose healthcheck, so that
 * process reads as "running" to an operator and to `docker compose ps`. A non-zero
 * exit is the same refusal made visible: the container dies, `restart: unless-stopped`
 * restarts it, and the message is the last thing in `docker logs`.
 *
 * The guard on `process.exit` is for Next's edge runtime, which loads this hook too
 * and has no such function. Neither app runs anything on the edge runtime today; if
 * one ever does, it re-throws and gets the 500-on-everything behaviour instead of a
 * `TypeError` that hides the real message.
 *
 * The twin is `apps/admin/instrumentation.ts`. **Change one, change the other.**
 */
function refuseInsecureCookieConfiguration(): void {
  try {
    assertSecureCookiesConfigured();
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    if (typeof process.exit === "function") process.exit(1);
    throw error;
  }
}

export function register(): void {
  refuseInsecureCookieConfiguration();

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
