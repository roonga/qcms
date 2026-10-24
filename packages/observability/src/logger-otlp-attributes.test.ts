import { logs, type Logger as OtelLogger, type LogRecord } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonLogger } from "./logger.js";

// The logger's own half of the SEC-13 control, in front of the allowlisting
// processor: only scalar fields become attributes, so an error, which redaction
// turns into an object, never becomes one at all.

const ERROR_CANARY = "OTLP_LOGGER_ERROR_CANARY";
const STACK_CANARY = "OTLP_LOGGER_STACK_CANARY";
const NESTED_CANARY = "OTLP_LOGGER_NESTED_CANARY";

// Through the documented seam, not the internal helper: a test that reaches
// past the production path can pass while that path is broken.
function captureEmittedRecords(): LogRecord[] {
  const records: LogRecord[] = [];
  const logger: OtelLogger = {
    emit: (record) => {
      records.push(record);
    },
    enabled: () => true,
  };
  logs.setGlobalLoggerProvider({ getLogger: () => logger });
  return records;
}

afterEach(() => {
  logs.disable();
});

describe("logger to OTLP attributes", () => {
  it("exports scalar fields but never an Error's message or stack", () => {
    const records = captureEmittedRecords();
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => lines.push(line),
      sendToOpenTelemetry: true,
    });

    const error = new Error(ERROR_CANARY);
    error.stack = `Error: ${ERROR_CANARY}\n    at ${STACK_CANARY} (redacted.ts:1:1)`;
    logger.error("unhandled error", { requestId: "req_1", status: 500, err: error });

    // An absence assertion over a record never emitted would pass for the
    // wrong reason.
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.body).toBe("unhandled error");
    expect(record.attributes?.requestId).toBe("req_1");
    expect(record.attributes?.status).toBe(500);

    expect(record.attributes).not.toHaveProperty("err");
    expect(JSON.stringify(record)).not.toContain(ERROR_CANARY);
    expect(JSON.stringify(record)).not.toContain(STACK_CANARY);

    // The same call's stdout line keeps both, which makes the drop a decision.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(ERROR_CANARY);
    expect(lines[0]).toContain(STACK_CANARY);
    expect(lines[0]).toContain("req_1");
  });

  it("drops every non-scalar field, not only Errors", () => {
    const records = captureEmittedRecords();
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => lines.push(line),
      sendToOpenTelemetry: true,
    });

    logger.info("request", {
      path: "/forms",
      durationMs: 12,
      ok: true,
      config: { nested: NESTED_CANARY },
      tags: [NESTED_CANARY],
    });

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.attributes?.path).toBe("/forms");
    expect(record.attributes?.durationMs).toBe(12);
    expect(record.attributes?.ok).toBe(true);

    expect(record.attributes).not.toHaveProperty("config");
    expect(record.attributes).not.toHaveProperty("tags");
    expect(JSON.stringify(record)).not.toContain(NESTED_CANARY);

    expect(lines[0]).toContain(NESTED_CANARY);
  });

  it("emits nothing to OpenTelemetry when the export is not switched on", () => {
    const records = captureEmittedRecords();
    const lines: string[] = [];
    const logger = createJsonLogger({ write: (line) => lines.push(line) });

    logger.info("request", { requestId: "req_2" });

    expect(lines).toHaveLength(1);
    expect(records).toHaveLength(0);
  });
});
