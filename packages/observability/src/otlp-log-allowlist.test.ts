import { describe, expect, it, vi } from "vitest";

import { allowlistingLogRecordProcessor, safeEventName } from "./otlp-log-allowlist.js";

describe("OTLP log allowlist", () => {
  it("keeps a closed event vocabulary", () => {
    expect(safeEventName("request")).toBe("request");
    expect(safeEventName("answer canary in a free-text message")).toBe("application.event");
  });

  it("removes arbitrary content before the next processor can queue it", () => {
    const attributes: Record<string, unknown> = {
      requestId: "req_1",
      method: "POST",
      status: 500,
      answerValue: "OTLP_ANSWER_CANARY",
      err: { message: "OTLP_ERROR_CANARY", stack: "OTLP_STACK_CANARY" },
      credential: "OTLP_CREDENTIAL_CANARY",
    };
    const record = {
      body: "OTLP_MESSAGE_CANARY",
      attributes,
      setBody: vi.fn(function (this: { body: unknown }, body: unknown) {
        this.body = body;
        return this;
      }),
    };

    allowlistingLogRecordProcessor().onEmit(record as never);

    expect(record.body).toBe("application.event");
    expect(attributes).toEqual({ requestId: "req_1", method: "POST", status: 500 });
    expect(JSON.stringify(record)).not.toMatch(
      /OTLP_(ANSWER|CREDENTIAL|ERROR|STACK|MESSAGE)_CANARY/,
    );
  });

  it("keeps the environment a per-environment job's line is about (task 067, SEC-13)", () => {
    // The deliverer and the retention sweep each start once per process and iterate the
    // live set (ADR-40, Q2), so every count they log is a count **in** one environment -
    // and until this field travelled, the line saying an outbox was not draining did not
    // say which one. Safe for the reason `scheduler` is: the value is an operator's own
    // name for a schema, out of `control.environments`, and names no respondent.
    const attributes: Record<string, unknown> = {
      environment: "test",
      redactedCount: 3,
      payload: "OTLP_PAYLOAD_CANARY",
    };
    const record = {
      body: "outbox payload answers redacted",
      attributes,
      setBody: vi.fn(function (this: { body: unknown }, body: unknown) {
        this.body = body;
        return this;
      }),
    };

    allowlistingLogRecordProcessor().onEmit(record as never);

    expect(record.body).toBe("outbox payload answers redacted");
    expect(attributes).toEqual({ environment: "test", redactedCount: 3 });
  });
});
