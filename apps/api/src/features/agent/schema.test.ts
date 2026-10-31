import { describe, expect, it } from "vitest";

import { ActionResultTurnBody, ActionStepResultBody } from "./schema.js";

/**
 * The `action-result` turn's closed schema (section 5.3, criterion 8): the fields a step
 * may report are its kind's own allowlist, so the one channel back into the conversation
 * cannot carry a minted URL, a secret or a recovery code.
 */

describe("one step's reported result", () => {
  it("accepts the kind's own allowlisted fields", () => {
    const parsed = ActionStepResultBody.safeParse({
      kind: "link.mint",
      outcome: "done",
      result: { count: 20, expiresAt: "2026-11-30T00:00:00.000Z", environment: "test" },
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a minted URL, which `link.mint` does not report", () => {
    const parsed = ActionStepResultBody.safeParse({
      kind: "link.mint",
      outcome: "done",
      result: { count: 1, url: "https://forms.example.test/l/abc" },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toContain("result.url");
  });

  it("refuses a field one kind reports when another kind reported it", () => {
    const parsed = ActionStepResultBody.safeParse({
      kind: "link.revoke",
      outcome: "done",
      result: { version: 3 },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a kind outside the registry", () => {
    const parsed = ActionStepResultBody.safeParse({ kind: "webhook.rotate", outcome: "done" });
    expect(parsed.success).toBe(false);
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
