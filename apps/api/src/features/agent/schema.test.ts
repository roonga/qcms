import { describe, expect, it } from "vitest";

import {
  ActionResultTurnBody,
  ActionStepResultBody,
  BUILDER_FACTS,
  LayoutReportFact,
  PreviewSelectionFact,
  ScreenAssistBody,
  conversationRefusal,
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
    expect(refusalFor({ kind: "workspace.archive", outcome: "done" })).toContain(
      "workspace.archive",
    );
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
    expect(conversationRefusal(turn({ count: 2 }))).toBeUndefined();
    expect(conversationRefusal(turn({ version: 3 }))).toContain("version");
  });

  it("passes a waiting card and refuses one naming a kind that does not exist", () => {
    const waiting = (kind: string): ConversationTurnBody[] => [
      { role: "user", content: "hi" },
      { role: "proposal", proposalId: "prp_abc", steps: [{ kind }] },
    ];
    expect(conversationRefusal(waiting("form.publish"))).toBeUndefined();
    expect(conversationRefusal(waiting("form.obliterate"))).toContain("form.obliterate");
  });
});

describe("the posted conversation's length", () => {
  const body = (turns: number): unknown => ({
    conversation: [
      ...Array.from({ length: turns - 1 }, (_value, index) => ({
        role: "user",
        content: `turn ${String(index)}`,
      })),
      { role: "proposal", proposalId: "prp_abc", steps: [{ kind: "form.publish" }] },
    ],
    screen: "forms",
    conversationId: "cnv_abc",
  });

  it("accepts a full history whose last turn is the waiting card", () => {
    expect(ScreenAssistBody.safeParse(body(40)).success).toBe(true);
  });

  it("refuses one turn more", () => {
    expect(ScreenAssistBody.safeParse(body(41)).success).toBe(false);
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

describe("the builder facts (G1)", () => {
  const SENTINEL = "RESPONDENT-ONLY-SENTINEL-VALUE";
  const selection = {
    fact: "preview-selection",
    formId: "frm_contact",
    stepId: "stp_one",
    questionId: "q_first_name",
    device: "phone",
    viewport: { width: 390, height: 844 },
  };
  const layout = {
    fact: "layout-report",
    formId: "frm_contact",
    stepId: "stp_one",
    device: "tablet",
    viewport: { width: 768, height: 1024 },
    orientation: "portrait",
    zoomPercent: 100,
    colorScheme: "dark",
    highContrast: false,
    pageHeight: 1800,
    findings: [{ questionId: "q_first_name", issue: "truncated-label" }],
  };

  it("accepts a measured selection and layout report", () => {
    expect(PreviewSelectionFact.safeParse(selection).success).toBe(true);
    expect(LayoutReportFact.safeParse(layout).success).toBe(true);
  });

  it("refuses an extra key at any depth", () => {
    expect(PreviewSelectionFact.safeParse({ ...selection, label: "First name" }).success).toBe(
      false,
    );
    expect(
      LayoutReportFact.safeParse({
        ...layout,
        findings: [{ questionId: "q_first_name", issue: "clipped", text: "First name" }],
      }).success,
    ).toBe(false);
    expect(
      LayoutReportFact.safeParse({ ...layout, viewport: { width: 768, height: 1024, dpr: 2 } })
        .success,
    ).toBe(false);
  });

  it("refuses a free string or authored text where an id or an enum goes", () => {
    expect(
      PreviewSelectionFact.safeParse({ ...selection, questionId: "What is your first name?" })
        .success,
    ).toBe(false);
    expect(
      LayoutReportFact.safeParse({
        ...layout,
        findings: [{ questionId: "q_first_name", issue: "the label reads Jane Doe" }],
      }).success,
    ).toBe(false);
    expect(LayoutReportFact.safeParse({ ...layout, device: "Jane's phone" }).success).toBe(false);
  });

  it("refuses the respondent sentinel in every string slot of both facts", () => {
    const cases: readonly [string, typeof PreviewSelectionFact | typeof LayoutReportFact, object][] =
      [
        ["selection formId", PreviewSelectionFact, { ...selection, formId: SENTINEL }],
        ["selection stepId", PreviewSelectionFact, { ...selection, stepId: SENTINEL }],
        ["selection questionId", PreviewSelectionFact, { ...selection, questionId: SENTINEL }],
        ["selection instanceId", PreviewSelectionFact, { ...selection, instanceId: SENTINEL }],
        ["selection device", PreviewSelectionFact, { ...selection, device: SENTINEL }],
        ["layout formId", LayoutReportFact, { ...layout, formId: SENTINEL }],
        ["layout stepId", LayoutReportFact, { ...layout, stepId: SENTINEL }],
        ["layout orientation", LayoutReportFact, { ...layout, orientation: SENTINEL }],
        ["layout colorScheme", LayoutReportFact, { ...layout, colorScheme: SENTINEL }],
        [
          "layout finding",
          LayoutReportFact,
          { ...layout, findings: [{ questionId: SENTINEL, issue: "clipped" }] },
        ],
      ];
    for (const [name, schema, value] of cases) {
      expect(schema.safeParse(value).success, name).toBe(false);
    }
  });

  it("lists both facts for the vocabulary walk", () => {
    expect(BUILDER_FACTS.map((entry) => entry.name)).toEqual([
      "fact preview-selection",
      "fact layout-report",
    ]);
  });
});
