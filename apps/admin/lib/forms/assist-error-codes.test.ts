import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messageForError, type AssistPanelErrorKind } from "@/components/forms/assist-panel";
import { ASSIST_ERROR_CODES } from "@/lib/forms/assist-stream";

/**
 * The emitted event and the rendered copy cannot drift apart (task 041).
 *
 * This exists because of a real defect rather than in the abstract: `STEP_LIMIT`
 * was declared in the API's error union, had a sentence written for it in this
 * app's catalogue, and was **never emitted** - so a turn that exhausted
 * `QCMS_AGENT_MAX_STEPS` reported `NO_PROPOSAL` and misdescribed what happened.
 * Fixing the instance would have reset the clock; the unenforced correspondence
 * between the two declarations is what actually failed.
 *
 * Three links are pinned here, and the API pins the fourth
 * (`assist/assistant.test.ts` asserts every declared code is reachable from some
 * scripted scenario):
 *
 *  1. this app's mirrored code list equals the API's own declaration;
 *  2. every code resolves to non-empty, non-placeholder copy;
 *  3. no code silently shares a sentence with another, since two failures that
 *     read identically are the same bug in a different costume.
 *
 * The API's declaration is read as **text**, not imported: this app is a strict
 * BFF and takes no value import from the API (R2, enforced by
 * `lib/server/r2-import-surface.test.ts`). Reading the file keeps the assertion
 * honest without creating the coupling that rule forbids.
 */

const API_TYPES = fileURLToPath(
  new URL("../../../api/src/features/forms/assist/types.ts", import.meta.url),
);

/** The `ASSIST_ERROR_CODES` array literal, lifted out of the API's source. */
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
    // The fixture is real: if the parse returned nothing, the equality below
    // would pass vacuously against an empty admin list one day.
    expect(fromApi.length).toBeGreaterThan(0);
    expect([...fromApi].sort()).toEqual([...ASSIST_ERROR_CODES].sort());
  });
});

describe("every assist error code renders copy", () => {
  it.each(ASSIST_ERROR_CODES)("%s has a real sentence", (code) => {
    const rendered = messageForError({ kind: code, message: "upstream detail" });
    expect(rendered.trim().length).toBeGreaterThan(0);
    // A missing catalogue entry surfaces as the key echoed back, which is copy in
    // the letter but not in the spirit.
    expect(rendered).not.toContain("forms.assist.error");
    // An uninterpolated placeholder is the other way this passes while being broken.
    expect(rendered).not.toMatch(/\{[a-z]+\}/iu);
  });

  it("gives each code its own sentence", () => {
    const rendered = ASSIST_ERROR_CODES.map((code) =>
      messageForError({ kind: code, message: "upstream detail" }),
    );
    expect(new Set(rendered).size).toBe(ASSIST_ERROR_CODES.length);
  });

  it("names step exhaustion as its own failure, not as silence", () => {
    // The distinction the API fix exists to make, asserted on the copy side too:
    // an operator tuning a prompt has to be able to tell "it ran out of steps"
    // from "it did not answer", and identical sentences would hide that.
    const exhausted = messageForError({ kind: "STEP_LIMIT" });
    const silent = messageForError({ kind: "NO_PROPOSAL" });
    expect(exhausted).not.toBe(silent);
    expect(exhausted.toLowerCase()).toContain("step");
  });

  it("still renders the panel-only kinds the API never sends", () => {
    // TOOL_REJECTED, RATE_LIMITED, STALE_DRAFT and HTTP are this app's own
    // states, derived from an event type or an HTTP status rather than from an
    // error code. They are excluded from the mirror above on purpose, so they
    // need their own check that the resolver handles them.
    const panelOnly: readonly AssistPanelErrorKind[] = [
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
