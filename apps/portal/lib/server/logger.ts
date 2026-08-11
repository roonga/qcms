import { createJsonLogger } from "@qcms/observability/logger";

/** Server-only JSON logger with active-trace correlation and safe OTLP emission. */
export const serverLogger = createJsonLogger({
  base: { service: "qcms-portal" },
  write: (line) => process.stdout.write(`${line}\n`),
  sendToOpenTelemetry: true,
});
