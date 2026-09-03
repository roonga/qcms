import { createJsonLogger } from "@qcms/observability/logger";

export const serverLogger = createJsonLogger({
  base: { service: "qcms-admin" },
  write: (line) => process.stdout.write(`${line}\n`),
  sendToOpenTelemetry: true,
});
