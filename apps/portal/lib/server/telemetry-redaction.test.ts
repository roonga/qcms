import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import {
  redactPath,
  redactingSpanProcessor,
  sanitizeAttributes,
  sanitizeSpan,
} from "./telemetry-redaction";

/**
 * SEC-13 on the portal's spans (task 054). The case that matters most here and
 * nowhere else: the secure-link token is a path segment (`/l/<token>`), so it
 * reaches the span NAME as well as the URL attributes, and a `lnk_` token is a
 * credential that may not leave the process in any signal.
 */

/** A ReadableSpan stand-in carrying only the fields the redactor reads. */
function spanWith(
  name: string,
  attributes: Attributes,
  events: ReadableSpan["events"] = [],
): ReadableSpan {
  return { name, attributes, events } as unknown as ReadableSpan;
}

describe("redactPath", () => {
  it("replaces a secure-link token with the route pattern", () => {
    expect(redactPath("/l/lnk_tok_abcdef123456")).toBe("/l/[token]");
    expect(redactPath("GET /l/lnk_tok_abcdef123456")).toBe("GET /l/[token]");
    expect(redactPath("http://localhost:7000/l/lnk_tok_abcdef123456")).toBe(
      "http://localhost:7000/l/[token]",
    );
  });

  it("removes the query string and the fragment", () => {
    expect(redactPath("/s/ses_1/step?step=2")).toBe("/s/ses_1/step");
    expect(redactPath("/l/tok?x=1#y")).toBe("/l/[token]");
  });

  it("leaves branded ids and slugs alone (pseudonymous correlators)", () => {
    expect(redactPath("GET /s/ses_abc123")).toBe("GET /s/ses_abc123");
    expect(redactPath("/f/vehicle-insurance-quote")).toBe("/f/vehicle-insurance-quote");
  });

  it("leaves an ins_ instance id alone too (task 075, SEC-13)", () => {
    // `ins_` joins the permitted correlators: random, opaque, session-scoped, and
    // carrying no respondent content. Nothing is added to this module for it, which is
    // the assertion - only `lnk_`, a credential in a path, is rewritten, so a new
    // branded id needs no change here and this pins that it did not accidentally get one.
    expect(redactPath("POST /s/ses_abc123/op/ins_7k2")).toBe("POST /s/ses_abc123/op/ins_7k2");
  });
});

describe("sanitizeAttributes", () => {
  it("keeps the Next and HTTP attributes a trace is read through", () => {
    const attributes: Attributes = {
      "next.span_type": "BaseServer.handleRequest",
      "next.route": "/s/[sessionId]",
      "http.method": "GET",
      "http.status_code": 200,
      "http.target": "/s/ses_abc",
    };
    sanitizeAttributes(attributes);
    expect(attributes).toEqual({
      "next.span_type": "BaseServer.handleRequest",
      "next.route": "/s/[sessionId]",
      "http.method": "GET",
      "http.status_code": 200,
      "http.target": "/s/ses_abc",
    });
  });

  it("redacts the token out of every path-shaped attribute it keeps", () => {
    const attributes: Attributes = {
      "http.target": "/l/lnk_tok_secret",
      "http.url": "http://localhost:7000/l/lnk_tok_secret",
      "next.span_name": "GET /l/lnk_tok_secret",
      "resource.name": "GET /l/lnk_tok_secret",
    };
    sanitizeAttributes(attributes);
    expect(JSON.stringify(attributes)).not.toContain("lnk_tok_secret");
    expect(attributes["http.target"]).toBe("/l/[token]");
  });

  it("drops an instance label and a repeated answer value (task 075)", () => {
    // The repeat-shaped leaks, none of them named in the allowlist and therefore all
    // deleted without being inspected: an instance's rendered heading (authored
    // `LocalizedText`, which SEC-13 excludes outright), the roster's size, and an answer
    // value under a qualified field name.
    const attributes: Attributes = {
      "http.method": "POST",
      "qcms.instance_label": "Vehicle 2",
      "qcms.instance_count": 3,
      "form.field.ins_7k2/q_rf_notes": "A kerbed wheel.",
    };
    sanitizeAttributes(attributes);
    expect(Object.keys(attributes)).toEqual(["http.method"]);
  });

  it("drops everything the allowlist does not name", () => {
    const attributes: Attributes = {
      "http.method": "POST",
      "http.request.header.x-qcms-internal-token": "internal-secret",
      "http.request.header.authorization": "Bearer session-secret",
      "qcms.answer": "My private answer",
    };
    sanitizeAttributes(attributes);
    expect(Object.keys(attributes)).toEqual(["http.method"]);
  });
});

describe("sanitizeSpan", () => {
  it("redacts the span name, because Next builds it from the raw pathname", () => {
    const span = spanWith("GET /l/lnk_tok_secret", { "http.target": "/l/lnk_tok_secret" });
    sanitizeSpan(span);
    expect(span.name).toBe("GET /l/[token]");
    expect(JSON.stringify(span)).not.toContain("lnk_tok_secret");
  });

  it("keeps exception.type and drops the message and the stack", () => {
    const span = spanWith("GET /s/[sessionId]", {}, [
      {
        name: "exception",
        time: [0, 0],
        attributes: {
          "exception.type": "ApiError",
          "exception.message": 'rejected "My private answer"',
          "exception.stacktrace": "ApiError: ...",
        },
        droppedAttributesCount: 0,
      },
    ]);
    sanitizeSpan(span);
    expect(span.events[0]?.attributes).toEqual({ "exception.type": "ApiError" });
  });
});

describe("redactingSpanProcessor", () => {
  it("redacts at onEnd, not at onStart", async () => {
    const processor = redactingSpanProcessor();
    const span = spanWith("GET /l/lnk_tok_secret", { "http.target": "/l/lnk_tok_secret" });

    processor.onStart(span as never, undefined as never);
    expect(span.name).toBe("GET /l/lnk_tok_secret");

    processor.onEnd(span);
    expect(span.name).toBe("GET /l/[token]");

    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});
