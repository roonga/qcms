/**
 * Child-process entry for the browser suite's composed API.
 *
 * Keeping application instrumentation out of Playwright's coordinator process is
 * production-faithful and prevents module-loader hooks from observing Playwright's
 * temporary Babel cache swaps on Windows.
 */

import { startTelemetry } from "../../../api/src/telemetry.js";

import { OTEL_SERVICE_NAMES, OTLP_ENDPOINT, OTLP_SCHEDULE_DELAY_MS } from "./harness-config.js";

type ParentMessage = { readonly type: "shutdown" };

async function run(): Promise<void> {
  process.env.OTEL_BSP_SCHEDULE_DELAY = OTLP_SCHEDULE_DELAY_MS;
  const telemetry = await startTelemetry({
    env: {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
      OTEL_SERVICE_NAME: OTEL_SERVICE_NAMES.api,
    },
  });
  const { startApiServer, stopApiServer } = await import("./api-server.js");

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await stopApiServer();
    await telemetry.shutdown();
    process.send?.({ type: "stopped" });
    process.disconnect?.();
  };

  process.on("message", (message: ParentMessage) => {
    if (message?.type === "shutdown") void stop();
  });
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());

  await startApiServer();
  process.send?.({ type: "ready" });
}

void run().catch((error: unknown) => {
  process.send?.({ type: "fatal", error: error instanceof Error ? error.name : "Error" });
  process.exitCode = 1;
});
