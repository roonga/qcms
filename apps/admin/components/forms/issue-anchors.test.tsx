import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ruleHref } from "../../lib/forms/issues.ts";
import type { DraftForm, FormIssue } from "../../lib/forms/types.ts";

/**
 * Where an issue link POINTS, now that one of its three destinations is on another route.
 *
 * Issue #669 moved rule editing to `/forms/{formId}/rules` and attached a mandatory
 * constraint to the move: "any behaviour that today resolves against ids on the builder
 * page must survive", with a surviving link carrying "the route as well as the fragment,
 * not a bare `#fragment` that resolves to nothing off-page". `IssueEntry` is where all of
 * that lands, because it is the ONE renderer of an issue - the validation panel's list and
 * the refused publish's work list are the same component in two places, deliberately, so
 * that an author does not meet two renderings of one sentence.
 *
 * That shared renderer is also why this file asserts both directions. The three anchors an
 * issue can name are now split across two routes:
 *
 * - a **rule** is on the rules screen, and its link must carry that route;
 * - a **step** and a **pinned question** are on the builder, and their links must NOT -
 *   sending those to a route would be the same defect pointing the other way.
 *
 * ## The publish path, checked rather than assumed
 *
 * The ruling asks specifically that "the refused-publish path that reuses the validation
 * list must be re-checked so it is not collaterally broken by the rules route". It reuses
 * `IssueEntry` verbatim, so the check is that the component's own answer is right for every
 * kind of issue - which is what the cases below are - plus `form-actions-rejects.test.tsx`,
 * which renders the rejection list itself.
 *
 * ## Why this layer
 *
 * An href is a string in the markup and nothing about a wrong one looks wrong on screen: a
 * bare fragment aimed at an absent element renders, announces as a link, takes focus, and
 * does nothing. A static render is the highest layer that can read the attribute directly.
 * That a press actually LANDS - the far screen focusing the row named by the fragment - is
 * a browser question and is asserted in `e2e/forms-publish.pw.ts`.
 */

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

/** The single `href` a rendered entry carries, or `""` when it rendered as plain text. */
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
    // A link to a rule the form does not have is a link to nothing, wherever it points.
    // Nothing is dropped: the sentence is still rendered, it is simply not a link.
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

    // The other direction of the same rule. A pin lives inside one step's editor on
    // `/forms/{formId}`, and `IssueEntry` selects the owning step and then focuses - so a
    // route on this href would send the reader off the screen the control is on.
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
