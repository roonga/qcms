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
});
