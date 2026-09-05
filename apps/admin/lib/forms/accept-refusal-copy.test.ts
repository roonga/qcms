import { describe, expect, it } from "vitest";

import { readResult } from "../server/api-result.ts";

/**
 * What the operator reads when an accept is refused (issue #823).
 *
 * The accept either stores the draft and creates every proposed question or stores
 * nothing, so the sentence has one job: say that nothing was saved, and say which of
 * the questions on the proposal card caused it. Before this, all three refusals fell
 * through to the generic "The request failed (INVALID_QUESTION_DEFINITION)" - observed
 * live on the 041 repro stack, which is what put this file here. A code is not a
 * sentence, and an operator looking at a card listing three questions cannot act on it.
 */

function refusal(code: string, details: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { code, message: "server prose", details } }), {
    status: 422,
    headers: { "content-type": "application/json" },
  });
}

async function messageFor(code: string, details: Record<string, unknown>): Promise<string> {
  const result = await readResult(refusal(code, details));
  if (result.ok) throw new Error("expected a failure");
  return result.message;
}

describe("an accept refusal, as the builder renders it", () => {
  it("names the refused question and the reason, and says nothing was saved", async () => {
    const message = await messageFor("INVALID_QUESTION_DEFINITION", {
      questionId: "q_bad_pattern",
      issues: [
        {
          code: "PATTERN_NOT_BROWSER_SAFE",
          message: "A browser compiles the pattern attribute with the 'v' flag.",
          path: ["constraints", "pattern"],
        },
      ],
    });
    expect(message).toContain("Nothing was saved");
    expect(message).toContain("q_bad_pattern");
    expect(message).toContain("'v' flag");
    // Never the bare code: that is the state this file exists to prevent regressing to.
    expect(message).not.toContain("INVALID_QUESTION_DEFINITION");
  });

  it("names the question whose id was already used, and cites the rule", async () => {
    const message = await messageFor("QUESTION_ID_REUSED", { questionId: "q_first_name" });
    expect(message).toContain("Nothing was saved");
    expect(message).toContain("q_first_name");
    expect(message).toContain("R6");
  });

  it("names the question whose slug collided", async () => {
    const message = await messageFor("SLUG_TAKEN", {
      questionId: "q_first_name",
      slug: "first-name",
    });
    expect(message).toContain("Nothing was saved");
    expect(message).toContain("q_first_name");
  });

  it("leaves every other code's sentence alone", async () => {
    // The context is ignored by a message with no placeholders for it, so adding the
    // two parameters cannot have changed what any existing screen says.
    const message = await messageFor("FORM_NOT_FOUND", { questionId: "q_x" });
    expect(message).toBe("That form does not exist.");
  });

  it("still falls back to the generic sentence for a code it has never heard of", async () => {
    expect(await messageFor("SOMETHING_NEW", {})).toContain("SOMETHING_NEW");
  });
});
