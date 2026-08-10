import { createJsonLogger } from "@qcms/observability/logger";

/** Server-only logger. Pino is required lazily after instrumentation.ts has run. */
export const serverLogger = createJsonLogger({
  base: { service: "qcms-portal" },
  write: (line) => process.stdout.write(`${line}\n`),
  sendToOpenTelemetry: true,
});
