import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";

import {
  redactUrl,
  redactingSpanProcessor,
  sanitizeAttributes,
  sanitizeSpan,
} from "./telemetry-redaction.js";

/**
 * SEC-13 (task 054, exit criterion 4). The allowlist is the control; these cases
 * pin the three ways it is meant to bite: an unknown attribute is dropped, a URL
 * loses its query, and an exception keeps its type but never its message.
 *
 * The e2e counterpart (`apps/portal/e2e/otel-trace.pw.ts`) proves the same
 * property end to end against real exported OTLP payloads; this proves it on the
 * unit that decides it.
 */

/** A ReadableSpan stand-in carrying only the fields the redactor reads. */
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

  it("drops every attribute the allowlist does not name", () => {
    const attributes: Attributes = {
      "http.request.method": "GET",
      // The shapes SEC-13 exists for: a bound answer value, a secure-link token,
      // the SEC-4 internal token, and an authorization header, however an
      // instrumentation or a future config option chose to spell them.
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
          "exception.stacktrace": "ApiError: value \"My private answer\" ...",
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

    // onStart must not redact: attributes arrive throughout the span's life.
    processor.onStart(span as never, undefined as never);
    expect(span.attributes["code.filepath"]).toBe("/src/routes/health.ts");

    processor.onEnd(span);
    expect(span.attributes).toEqual({ "http.route": "/health" });

    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});
