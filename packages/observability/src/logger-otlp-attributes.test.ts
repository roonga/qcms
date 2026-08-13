import { logs, type Logger as OtelLogger, type LogRecord } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonLogger } from "./logger.js";

/**
 * The logger's own half of the SEC-13 log control.
 *
 * `otlp-log-allowlist.test.ts` covers the processor that runs after this one, and it
 * already proves an `err: { message, stack }` attribute is stripped before export. That
 * left the layer in front of it unasserted: `scalarAttributes()` copies only string,
 * number and boolean fields, so an `Error` (which `redact()` turns into an object) never
 * becomes an OTLP attribute in the first place. Nothing pinned that, so widening
 * `scalarAttributes` to serialize objects would have been caught only by the allowlist,
 * and then only for keys outside its `SAFE_ATTRIBUTES` set.
 *
 * The asymmetry these tests pin is the deliberate one: **stdout is rich, OTLP is poor.**
 * The same call produces a stdout line carrying the message and the stack, for the
 * operator who is already inside the process boundary, and an exported record carrying
 * neither, because that one leaves for a backend outside our erasure reach.
 */

const ERROR_CANARY = "OTLP_LOGGER_ERROR_CANARY";
const STACK_CANARY = "OTLP_LOGGER_STACK_CANARY";
const NESTED_CANARY = "OTLP_LOGGER_NESTED_CANARY";

/**
 * Drive the real logger and capture what it hands OpenTelemetry.
 *
 * Through the documented API seam (`logs.setGlobalLoggerProvider`) rather than by
 * exporting `scalarAttributes` for the test: the property under test is what the
 * production path emits, and a test that reaches past that path can pass while the path
 * itself is broken.
 */
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

    // Positive control first. An absence assertion over a record that was never emitted,
    // or that carries no attributes at all, would pass for entirely the wrong reason.
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.body).toBe("unhandled error");
    expect(record.attributes?.requestId).toBe("req_1");
    expect(record.attributes?.status).toBe(500);

    // The object field is dropped rather than serialized.
    expect(record.attributes).not.toHaveProperty("err");
    expect(JSON.stringify(record)).not.toContain(ERROR_CANARY);
    expect(JSON.stringify(record)).not.toContain(STACK_CANARY);

    // And the contrast that makes the drop a decision rather than a loss: the same call's
    // stdout line keeps both, next to the same requestId.
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
    // Positive control: all three scalar kinds survive, so a wholesale drop is excluded.
    expect(record.attributes?.path).toBe("/forms");
    expect(record.attributes?.durationMs).toBe(12);
    expect(record.attributes?.ok).toBe(true);

    expect(record.attributes).not.toHaveProperty("config");
    expect(record.attributes).not.toHaveProperty("tags");
    expect(JSON.stringify(record)).not.toContain(NESTED_CANARY);

    // Again the contrast: stdout keeps the structure the export refuses.
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
