import { describe, expect, it } from "vitest";

import { readResult } from "../server/api-result.ts";

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
    const message = await messageFor("FORM_NOT_FOUND", { questionId: "q_x" });
    expect(message).toBe("That form does not exist.");
  });

  it("still falls back to the generic sentence for a code it has never heard of", async () => {
    expect(await messageFor("SOMETHING_NEW", {})).toContain("SOMETHING_NEW");
  });
});
