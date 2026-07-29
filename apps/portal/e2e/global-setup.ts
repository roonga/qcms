/**
 * Playwright globalSetup (task 029; tracing added by task 054): boot the in-test
 * OTLP receiver, start the API-side OTel SDK, then boot the composed API +
 * Testcontainers Postgres, seed the insurance fixture, and write the link-token
 * fixtures the specs read. Runs before any spec; the portal dev server (webServer)
 * only reaches the API during tests, so it may start before this completes.
 *
 * ## Why the API harness is imported dynamically (task 054)
 *
 * The OTel instrumentations patch their targets when those modules are first
 * `require`d - `pg` for database spans, `pino` for `trace_id` in the API's log
 * lines. `import { startApiServer } from "./support/api-server.js"` at module scope
 * would be hoisted above every statement below, load `pg` and `drizzle` before the
 * SDK exists, and leave the suite with a server span and no database spans under
 * it. The dynamic `import()` after `startTelemetry()` is what makes the ordering
 * real, and it is the same ordering `apps/api/src/serve.ts` enforces in production
 * (which is why `main.ts` is a separate module there).
 *
 * The whole suite runs traced on purpose: `otel-trace.pw.ts` then asserts the
 * connected trace and the SEC-13 redaction against payloads a real full-stack run
 * produced, rather than against one hand-built span.
 */

import { startTelemetry } from "../../api/src/telemetry.js";

import {
  OTEL_SERVICE_NAMES,
  OTLP_ENDPOINT,
  OTLP_SCHEDULE_DELAY_MS,
} from "./support/harness-config.js";
import { startOtlpReceiver } from "./support/otlp-receiver.js";

export default async function globalSetup(): Promise<void> {
  await startOtlpReceiver();

  // The batch span processor reads its schedule from the ambient environment
  // (`OTEL_BSP_SCHEDULE_DELAY`), not from the record passed below, so it is set
  // here, on the harness's own process, before the SDK is built.
  process.env.OTEL_BSP_SCHEDULE_DELAY = OTLP_SCHEDULE_DELAY_MS;

  await startTelemetry({
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
      OTEL_SERVICE_NAME: OTEL_SERVICE_NAMES.api,
    },
  });

  const { startApiServer } = await import("./support/api-server.js");
  await startApiServer();
}
