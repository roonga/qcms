import { describe, expect, it } from "vitest";

import {
  ActionResultTurnBody,
  ActionStepResultBody,
  actionResultRefusal,
  stepResultRefusal,
  type ActionStepResult,
  type ConversationTurnBody,
} from "./schema.js";

/**
 * The `action-result` turn's closed schema (section 5.3, criterion 8) and the allowlist
 * the route checks beside it, so the one channel back into the conversation cannot carry a
 * minted URL, a secret or a recovery code.
 */

function refusalFor(step: unknown): string | undefined {
  const parsed = ActionStepResultBody.safeParse(step);
  expect(parsed.success).toBe(true);
  return parsed.success ? stepResultRefusal(parsed.data) : undefined;
}

describe("one step's reported result", () => {
  it("accepts the kind's own allowlisted fields", () => {
    expect(
      refusalFor({
        kind: "link.mint",
        outcome: "done",
        result: { count: 20, expiresAt: "2026-11-30T00:00:00.000Z", environment: "test" },
      }),
    ).toBeUndefined();
  });

  it("refuses a minted URL, which no kind reports, at the schema itself", () => {
    expect(
      ActionStepResultBody.safeParse({
        kind: "link.mint",
        outcome: "done",
        result: { count: 1, url: "https://forms.example.test/l/abc" },
      }).success,
    ).toBe(false);
  });

  it("refuses a field one kind reports when another kind reported it", () => {
    // `version` is declared, since `form.publish` reports it, so the closed schema accepts
    // it and the per-kind narrowing is what refuses it.
    expect(refusalFor({ kind: "link.revoke", outcome: "done", result: { version: 3 } })).toContain(
      "version",
    );
  });

  it("refuses a kind outside the registry", () => {
    expect(refusalFor({ kind: "webhook.rotate", outcome: "done" })).toContain("webhook.rotate");
  });

  it("stays a closed object, so the published body rejects an undeclared key", () => {
    expect(
      ActionStepResultBody.safeParse({ kind: "link.mint", outcome: "done", extra: 1 }).success,
    ).toBe(false);
  });

  it("refuses an object or an array where a scalar belongs", () => {
    for (const value of [{ nested: true }, [1, 2]]) {
      const parsed = ActionStepResultBody.safeParse({
        kind: "form.publish",
        outcome: "done",
        result: { version: value },
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("accepts a step that reports nothing, which is every outcome but done", () => {
    for (const outcome of ["failed", "pending-approval", "not-run", "cancelled", "expired"]) {
      expect(ActionStepResultBody.safeParse({ kind: "form.release", outcome }).success).toBe(true);
    }
  });
});

describe("the conversation the route checks", () => {
  it("names the first refused step and passes an allowed turn", () => {
    const turn = (result: NonNullable<ActionStepResult["result"]>): ConversationTurnBody[] => [
      { role: "user", content: "hi" },
      {
        role: "action-result",
        proposalId: "prp_abc",
        steps: [{ kind: "link.mint", outcome: "done", result }],
      },
    ];
    expect(actionResultRefusal(turn({ count: 2 }))).toBeUndefined();
    expect(actionResultRefusal(turn({ version: 3 }))).toContain("version");
  });
});

describe("the turn the card sends", () => {
  it("carries the proposal id and at least one step", () => {
    const parsed = ActionResultTurnBody.safeParse({
      role: "action-result",
      proposalId: "prp_abc",
      steps: [
        { kind: "form.publish", outcome: "done", result: { version: 3 } },
        { kind: "form.release", outcome: "not-run" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an empty step list and a plan longer than the cap", () => {
    expect(
      ActionResultTurnBody.safeParse({ role: "action-result", proposalId: "prp_abc", steps: [] })
        .success,
    ).toBe(false);
    expect(
      ActionResultTurnBody.safeParse({
        role: "action-result",
        proposalId: "prp_abc",
        steps: Array.from({ length: 26 }, () => ({ kind: "link.mint", outcome: "not-run" })),
      }).success,
    ).toBe(false);
  });
});
