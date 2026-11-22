import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";

import { messageForFormCode } from "./errors.ts";

const API_MOVE = fileURLToPath(
  new URL("../../../api/src/features/workspaces/move.ts", import.meta.url),
);

// Read from the API rather than a list kept here, so a refusal added there arrives without copy
// and fails instead of reaching an operator as a bare code.
function apiMoveCodes(): readonly string[] {
  const source = readFileSync(API_MOVE, "utf8");
  const start = source.indexOf("export const moveFail = {");
  expect(start, "the API no longer declares moveFail").toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n} as const;", start));
  const codes = [...body.matchAll(/new ApiError\(\s*"(MOVE[A-Z_]*)"/gu)].map(
    (match) => match[1] ?? "",
  );
  return [...new Set(codes)];
}

describe("every move refusal the API can send has admin copy", () => {
  const codes = apiMoveCodes();

  it("finds the refusals the API declares", () => {
    expect(codes).toEqual(
      expect.arrayContaining([
        "MOVE_SAME_WORKSPACE",
        "MOVE_FORM_LEFT_SOURCE",
        "MOVER_LOST_EDIT_FORMS",
        "MOVE_DESTINATION_ARCHIVED",
      ]),
    );
  });

  it.each(codes)("%s reads as a sentence, not as the code", (code) => {
    const message = messageForFormCode(code);

    expect(message).not.toContain(code);
    expect(message).not.toBe(t("forms.error.unknown", { code }));
    expect(message).not.toMatch(/\{[a-z]+\}/iu);
    expect(message).toMatch(/\.$/u);
  });

  it("gives each refusal its own sentence", () => {
    const rendered = codes.map((code) => messageForFormCode(code));
    expect(new Set(rendered).size).toBe(codes.length);
  });

  it("names the rule each refusal turned on", () => {
    expect(messageForFormCode("MOVE_SAME_WORKSPACE")).toBe(t("forms.move.error.sameWorkspace"));
    expect(messageForFormCode("MOVE_FORM_LEFT_SOURCE")).toBe(t("forms.move.error.leftSource"));
    expect(messageForFormCode("MOVER_LOST_EDIT_FORMS")).toBe(
      t("forms.move.error.moverLostEditForms"),
    );
    expect(messageForFormCode("MOVE_DESTINATION_ARCHIVED")).toBe(
      t("forms.move.error.destinationArchived"),
    );
  });

  it("tells a held move that lapsed that nothing was applied", () => {
    const lapses = ["MOVE_FORM_LEFT_SOURCE", "MOVER_LOST_EDIT_FORMS", "MOVE_DESTINATION_ARCHIVED"];
    for (const code of lapses) {
      expect(messageForFormCode(code), code).toMatch(/nothing was applied/u);
    }
  });
});
