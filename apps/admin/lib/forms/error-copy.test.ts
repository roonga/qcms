// A refusal reaches a user as a whole sentence or not at all: a code the catalog does not map
// shows its own name, and a template whose parameter nobody supplies shows the braces.

import { describe, expect, it } from "vitest";

import { FORM_CODE_MESSAGES, messageForFormCode, type WebhookUrlRejection } from "./errors.ts";
import { LOGO_MAX_LABEL, LOGO_MAX_SIDE } from "./logo.ts";

const LOGO_CODES = [
  "INVALID_LOGO",
  "LOGO_NOT_RASTER",
  "LOGO_UNSUPPORTED",
  "LOGO_TOO_LARGE",
  "LOGO_TOO_MANY_PIXELS",
  "LOGO_TAKEN_DOWN",
  "LOGO_UNKNOWN",
] as const;

const REJECTIONS: readonly WebhookUrlRejection[] = [
  "not-a-url",
  "unsupported-scheme",
  "https-required",
  "private-host",
];

function expectWholeSentence(message: string, where: string): void {
  expect(message, `${where} leaves a parameter unfilled`).not.toMatch(/\{\w+\}/u);
  expect(message, `${where} does not start a sentence`).toMatch(/^[A-Z0-9"“`]/u);
  expect(message, `${where} does not end a sentence`).toMatch(/[.?!]$/u);
  expect(message.split(/\s+/u).length, `${where} is not a sentence`).toBeGreaterThanOrEqual(3);
}

describe("every mapped refusal", () => {
  it("covers a non-trivial set of codes", () => {
    expect(Object.keys(FORM_CODE_MESSAGES).length).toBeGreaterThan(50);
  });

  it("renders as a whole sentence with nothing left to fill in", () => {
    for (const code of Object.keys(FORM_CODE_MESSAGES)) {
      expectWholeSentence(messageForFormCode(code), code);
    }
  });

  it("renders as a whole sentence for every webhook rejection reason too", () => {
    for (const rejection of REJECTIONS) {
      expectWholeSentence(
        messageForFormCode("WEBHOOK_URL_REJECTED", { rejection }),
        `WEBHOOK_URL_REJECTED/${rejection}`,
      );
    }
  });
});

describe("the logo refusals", () => {
  it("name the act rather than the code the API sent", () => {
    for (const code of LOGO_CODES) {
      const message = messageForFormCode(code);
      expect(message, code).not.toContain(code);
      expect(message, code).not.toContain("The request failed");
      expectWholeSentence(message, code);
    }
  });

  it("carry the limits the upload route enforces", () => {
    expect(messageForFormCode("LOGO_TOO_LARGE")).toContain(LOGO_MAX_LABEL);
    expect(messageForFormCode("LOGO_TOO_MANY_PIXELS")).toContain(String(LOGO_MAX_SIDE));
  });
});
