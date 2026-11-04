import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messageForError, type AssistErrorKind } from "@/lib/forms/assist-errors";
import { ASSIST_ERROR_CODES } from "@/lib/forms/assist-stream";

const API_TYPES = fileURLToPath(
  new URL("../../../api/src/features/agent/types.ts", import.meta.url),
);

function apiErrorCodes(): string[] {
  const source = readFileSync(API_TYPES, "utf8");
  const start = source.indexOf("export const ASSIST_ERROR_CODES = [");
  expect(start, "the API no longer declares ASSIST_ERROR_CODES as an array").toBeGreaterThan(-1);
  const end = source.indexOf("]", start);
  const body = source.slice(source.indexOf("[", start) + 1, end);
  return [...body.matchAll(/"([A-Z_]+)"/gu)].map((match) => match[1] ?? "");
}

describe("assist error codes agree with the API", () => {
  it("mirrors the API's declaration exactly", () => {
    const fromApi = apiErrorCodes();

    expect(fromApi.length).toBeGreaterThan(0);
    expect([...fromApi].sort()).toEqual([...ASSIST_ERROR_CODES].sort());
  });
});

describe("every assist error code renders copy", () => {
  it.each(ASSIST_ERROR_CODES)("%s has a real sentence", (code) => {
    const rendered = messageForError({ kind: code, message: "upstream detail" });
    expect(rendered.trim().length).toBeGreaterThan(0);

    expect(rendered).not.toContain("forms.assist.error");

    expect(rendered).not.toMatch(/\{[a-z]+\}/iu);
  });

  it("gives each code its own sentence", () => {
    const rendered = ASSIST_ERROR_CODES.map((code) =>
      messageForError({ kind: code, message: "upstream detail" }),
    );
    expect(new Set(rendered).size).toBe(ASSIST_ERROR_CODES.length);
  });

  it("names step exhaustion as its own failure, not as silence", () => {
    const exhausted = messageForError({ kind: "STEP_LIMIT" });
    const silent = messageForError({ kind: "NO_PROPOSAL" });
    expect(exhausted).not.toBe(silent);
    expect(exhausted.toLowerCase()).toContain("step");
  });

  it("still renders the client-only kinds the API never sends", () => {
    const panelOnly: readonly AssistErrorKind[] = [
      "TOOL_REJECTED",
      "RATE_LIMITED",
      "STALE_DRAFT",
      "HTTP",
    ];
    for (const kind of panelOnly) {
      const rendered = messageForError({ kind, message: "detail", tool: "publish_form" });
      expect(rendered.trim().length, kind).toBeGreaterThan(0);
      expect(rendered, kind).not.toContain("forms.assist.error");
    }
  });
});
