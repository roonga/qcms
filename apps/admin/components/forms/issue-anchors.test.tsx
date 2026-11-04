import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ruleHref } from "../../lib/forms/issues.ts";
import type { DraftForm, FormIssue } from "../../lib/forms/types.ts";

const FORM_ID = "frm_anchors";

const DRAFT: DraftForm = {
  formId: FORM_ID,
  defaultLocale: "en",
  title: { en: "Life insurance" },
  steps: [
    {
      stepId: "stp_health",
      title: { en: "Health" },
      items: [{ questionId: "q_smoker", version: 1 }],
    },
  ],
  rules: [
    {
      ruleId: "rul_smoker_daily",
      when: { op: "answered", questionId: "q_smoker" },
      show: ["q_smoker"],
    },
  ],
};

async function render(issue: FormIssue): Promise<string> {
  const { IssueEntry } = await import("./validation-panel.tsx");
  return renderToStaticMarkup(<IssueEntry issue={issue} draft={DRAFT} />);
}

function href(markup: string): string {
  return /href="([^"]*)"/u.exec(markup)?.[1] ?? "";
}

describe("an issue that names a rule", () => {
  it("links to the rules route AND the rule's fragment, never to a bare fragment", async () => {
    const markup = await render({
      code: "RULE_BACKWARD_TARGET",
      message: "the rule targets an earlier question",
      path: { rule: "rul_smoker_daily" },
    });

    expect(href(markup)).toBe(ruleHref(FORM_ID, "rul_smoker_daily"));
    expect(href(markup)).toBe(`/forms/${FORM_ID}/rules#rule-rul_smoker_daily`);
  });

  it("does the same for a cycle, which names several rules and is anchored at the first", async () => {
    const markup = await render({
      code: "RULE_CYCLE",
      message: "these rules depend on each other",
      path: { rules: ["rul_smoker_daily", "rul_other"] },
    });

    expect(href(markup)).toBe(ruleHref(FORM_ID, "rul_smoker_daily"));
  });

  it("renders as plain text when the rule it names is not in the draft", async () => {
    const markup = await render({
      code: "RULE_CYCLE",
      message: "these rules depend on each other",
      path: { rule: "rul_deleted" },
    });

    expect(href(markup)).toBe("");
    expect(markup).toContain("these rules depend on each other");
  });
});

describe("an issue that names something still on the builder", () => {
  it("keeps a pinned question's link a bare fragment, because that is where the pin is", async () => {
    const markup = await render({
      code: "UNPUBLISHED_QUESTION_PIN",
      message: "this pin names an unpublished version",
      path: { question: "q_smoker" },
    });

    expect(href(markup)).toBe("#pin-q_smoker");
  });

  it("keeps a step's link a bare fragment, because the rail carries that id on every screen", async () => {
    const markup = await render({
      code: "DANGLING_STEP_REF",
      message: "a rule names a step this form does not have",
      path: { step: "stp_health" },
    });

    expect(href(markup)).toBe("#step-stp_health");
  });
});
