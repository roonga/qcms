import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";

import {
  redactUrl,
  redactingSpanProcessor,
  sanitizeAttributes,
  sanitizeSpan,
} from "./telemetry-redaction.js";

function spanWith(attributes: Attributes, events: ReadableSpan["events"] = []): ReadableSpan {
  return { attributes, events } as unknown as ReadableSpan;
}

describe("redactUrl", () => {
  it("removes the query string and the fragment", () => {
    expect(redactUrl("http://api.internal/sessions/ses_1/step?step=2")).toBe(
      "http://api.internal/sessions/ses_1/step",
    );
    expect(redactUrl("/s/ses_1/answers?step=0#frag")).toBe("/s/ses_1/answers");
  });

  it("leaves a plain path or absolute URL untouched", () => {
    expect(redactUrl("/sessions/ses_1/step")).toBe("/sessions/ses_1/step");
    expect(redactUrl("http://api.internal/health")).toBe("http://api.internal/health");
  });
});

describe("sanitizeAttributes", () => {
  it("keeps allowlisted attributes, including branded ids inside a route", () => {
    const attributes: Attributes = {
      "http.request.method": "POST",
      "http.route": "/sessions/:sessionId/answers",
      "http.response.status_code": 200,
      "url.path": "/sessions/ses_abc/answers",
      "db.statement": "insert into answers (session_id, question_id, value) values ($1, $2, $3)",
      "qcms.request_id": "req-1",
    };
    sanitizeAttributes(attributes);
    expect(attributes).toEqual({
      "http.request.method": "POST",
      "http.route": "/sessions/:sessionId/answers",
      "http.response.status_code": 200,
      "url.path": "/sessions/ses_abc/answers",
      "db.statement": "insert into answers (session_id, question_id, value) values ($1, $2, $3)",
      "qcms.request_id": "req-1",
    });
  });

  it("keeps an ins_ instance id as a pseudonymous correlator (task 075, SEC-13)", () => {
    // The allowlist is over attribute keys and never inspects a value, so an id inside
    // a route or a statement needs no entry of its own.
    const attributes: Attributes = {
      "http.route": "/sessions/:sessionId/answers/batch",
      "url.path": "/sessions/ses_abc/answers/batch",
      "db.statement": "insert into answers (session_id, instance_id, value) values ($1, $2, $3)",
      "qcms.request_id": "req-ins_7k2",
    };
    sanitizeAttributes(attributes);
    expect(attributes["qcms.request_id"]).toBe("req-ins_7k2");
    expect(attributes["db.statement"]).toContain("instance_id");
  });

  it("drops an instance label and a repeated answer value, however they are keyed", () => {
    const attributes: Attributes = {
      "http.request.method": "POST",
      "qcms.instance_label": "Passenger 2",
      "qcms.instance_count": 9,
      "answer.ins_7k2/q_passport": "P1234567",
    };
    sanitizeAttributes(attributes);
    expect(Object.keys(attributes)).toEqual(["http.request.method"]);
  });

  it("keeps the environment, so a trace can be attributed to one (task 067, criterion 6)", () => {
    const attributes: Attributes = {
      "qcms.environment": "test",
      "http.route": "/sessions/:id/step",
    };
    sanitizeAttributes(attributes);
    expect(attributes).toEqual({
      "qcms.environment": "test",
      "http.route": "/sessions/:id/step",
    });
  });

  it("drops every attribute the allowlist does not name", () => {
    const attributes: Attributes = {
      "http.request.method": "GET",
      "db.statement.parameters": "['My private answer']",
      "http.request.header.authorization": "Bearer secret",
      "http.request.header.x-qcms-internal-token": "internal-secret",
      "qcms.link_token": "lnk_tok_secret",
      "answer.value": "My private answer",
      "code.function": "submitAnswer",
    };
    sanitizeAttributes(attributes);
    expect(Object.keys(attributes)).toEqual(["http.request.method"]);
  });

  it("strips the query from URL-shaped values it keeps", () => {
    const attributes: Attributes = { "http.url": "http://api.internal/sessions?token=lnk_secret" };
    sanitizeAttributes(attributes);
    expect(attributes["http.url"]).toBe("http://api.internal/sessions");
  });
});

describe("sanitizeSpan", () => {
  it("keeps exception.type and drops the message and the stack", () => {
    const span = spanWith({}, [
      {
        name: "exception",
        time: [0, 0],
        attributes: {
          "exception.type": "ApiError",
          "exception.message": 'value "My private answer" is not a valid number',
          "exception.stacktrace": 'ApiError: value "My private answer" ...',
        },
        droppedAttributesCount: 0,
      },
    ]);
    sanitizeSpan(span);
    expect(span.events[0]?.attributes).toEqual({ "exception.type": "ApiError" });
  });

  it("tolerates an event with no attributes", () => {
    const span = spanWith({}, [{ name: "note", time: [0, 0], droppedAttributesCount: 0 }]);
    expect(() => sanitizeSpan(span)).not.toThrow();
  });
});

describe("redactingSpanProcessor", () => {
  it("sanitizes on onEnd, so late attributes are covered too", async () => {
    const processor = redactingSpanProcessor();
    const span = spanWith({ "http.route": "/health", "code.filepath": "/src/routes/health.ts" });

    processor.onStart(span as never, undefined as never);
    expect(span.attributes["code.filepath"]).toBe("/src/routes/health.ts");

    processor.onEnd(span);
    expect(span.attributes).toEqual({ "http.route": "/health" });

    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});
