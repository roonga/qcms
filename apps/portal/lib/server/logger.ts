import { createJsonLogger } from "@roonga/qcms-observability/logger";

export const serverLogger = createJsonLogger({
  base: { service: "qcms-portal" },
  write: (line) => process.stdout.write(`${line}\n`),
  sendToOpenTelemetry: true,
});
