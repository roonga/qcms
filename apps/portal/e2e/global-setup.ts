/**
 * Playwright globalSetup (task 029; tracing added by task 054): boot the in-test
 * OTLP receiver, then boot the traced composed API in its own Node process +
 * Testcontainers Postgres, seed the insurance fixture, and write the link-token
 * fixtures the specs read. Runs before any spec; the portal dev server (webServer)
 * only reaches the API during tests, so it may start before this completes.
 *
 * ## Why the API has its own process (task 062)
 *
 * The OTel instrumentations patch `pg` before the app graph loads.
 * Playwright also mutates its own module loader while creating workers; installing
 * application hooks in that coordinator process makes the two unrelated loaders
 * interfere on Windows. The child entry starts telemetry and only then imports the
 * API, matching `apps/api/src/serve.ts` and Compose.
 *
 * The whole suite runs traced on purpose: `otel-trace.pw.ts` then asserts the
 * connected trace and the SEC-13 redaction against payloads a real full-stack run
 * produced, rather than against one hand-built span.
 */

import { startApiProcess } from "./support/api-process-control.js";
import { startOtlpReceiver } from "./support/otlp-receiver.js";

export default async function globalSetup(): Promise<void> {
  await startOtlpReceiver();
  await startApiProcess();
}
