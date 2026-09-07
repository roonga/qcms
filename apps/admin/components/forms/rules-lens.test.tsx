import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ruleHref, rulesHref } from "../../lib/forms/issues.ts";
import type { DraftForm, FormIssue, PinnableQuestion } from "../../lib/forms/types.ts";
import type { ReadState } from "../../lib/read-state.ts";

/**
 * The builder's rules card is a read-only lens, and every way out of it carries the ROUTE.
 *
 * Issue #669's ruling has two halves and this file is the second one's guard. The first
 * half is that rule editing moves to `/forms/{formId}/rules`; the second is the mandatory
 * constraint that came with it - "any behaviour that today resolves against ids on the
 * builder page must survive the move", with links carrying "the route as well as the
 * fragment, not a bare `#fragment` that resolves to nothing off-page".
 *
 * A bare fragment is the exact failure mode: it renders, it is announced as a link, it is
 * keyboard-reachable, and pressing it does nothing at all. Nothing about the card LOOKS
 * wrong when it is broken, which is why the assertion is on the href rather than on
 * anything a person could see.
 *
 * ## Why this layer
 *
 * The card is pure: given a draft, a library and a verdict it renders one list. There is
 * no server call, no route, and no state, so a static render is the highest layer that can
 * see every branch - a form with rules, a form with none, and a form with nothing pinned
 * (which is a form no rule can be added to yet). The crossing itself, where a press has to
 * land on the far screen with focus on the right row, is a browser question and is asserted
 * in `e2e/forms-publish.pw.ts` and `e2e/forms-builder.pw.ts`.
 */

const FORM_ID = "frm_lens";

const LIBRARY: ReadState<readonly PinnableQuestion[]> = {
  ok: true,
  data: [
    {
      questionId: "q_smoker",
      slug: "smoker",
      label: { en: "Do you smoke?" },
      type: "boolean",
      versions: [
        {
          version: 1,
          status: "published",
          definition: { questionId: "q_smoker", type: "boolean", label: { en: "Do you smoke?" } },
        },
      ],
    },
    {
      questionId: "q_cigs",
      slug: "cigs",
      label: { en: "How many a day?" },
      type: "number",
      versions: [
        {
          version: 1,
          status: "published",
          definition: { questionId: "q_cigs", type: "number", label: { en: "How many a day?" } },
        },
      ],
    },
  ],
};

const DRAFT: DraftForm = {
  formId: FORM_ID,
  defaultLocale: "en",
  title: { en: "Life insurance" },
  steps: [
    {
      stepId: "stp_health",
      title: { en: "Health" },
      items: [
        { questionId: "q_smoker", version: 1 },
        { questionId: "q_cigs", version: 1 },
      ],
    },
  ],
  rules: [
    {
      ruleId: "rul_smoker_daily",
      when: { op: "equals", questionId: "q_smoker", value: true },
      show: ["q_cigs"],
    },
  ],
};

const ISSUE: FormIssue = {
  code: "RULE_BACKWARD_TARGET",
  message: "the rule targets an earlier question",
  path: { rule: "rul_smoker_daily" },
};

async function render(
  draft: DraftForm = DRAFT,
  issues: readonly FormIssue[] = [],
): Promise<string> {
  const { RulesLens } = await import("./rules-lens.tsx");
  return renderToStaticMarkup(<RulesLens draft={draft} library={LIBRARY} issues={issues} />);
}

/** Every `href` in a rendered fragment, in document order. */
function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

describe("the builder's rules lens", () => {
  it("addresses every rule by route AND fragment, never by a bare fragment", async () => {
    const markup = await render();

    // The whole ruling, as one assertion. `ruleHref` is what composes the two halves, and
    // it is imported rather than restated because the fragment has to equal the DOM id the
    // rules table puts on the row - a test that spelled the address out by hand could
    // agree with itself while disagreeing with the destination.
    expect(hrefs(markup)).toContain(ruleHref(FORM_ID, "rul_smoker_daily"));
    expect(
      hrefs(markup).filter((href) => href.startsWith("#")),
      "a bare fragment resolves to nothing once the rules are a route away",
    ).toStrictEqual([]);
  });

  it("offers a way to the rules screen and a way to add a rule, both as routes", async () => {
    const markup = await render();

    // The two footer links the drawing puts under the list
    // (`plan/admin-shell-poc/admin-shell-poc.html`): "Edit rules" and "+ Add rule". Both
    // are affordances the builder had before the split - the rules selection and its Add
    // rule button - so both have to be reachable after it.
    expect(hrefs(markup)).toContain(rulesHref(FORM_ID));
    expect(hrefs(markup)).toContain(`${rulesHref(FORM_ID)}#new-rule`);
  });

  it("states each rule as the same sentence the rules table states", async () => {
    const markup = await render();

    // `lib/forms/rule-sentence.ts` is the one place a rule is put into words, so the lens
    // and the screen it points at cannot describe one rule two ways.
    expect(markup).toContain("Do you smoke?");
    expect(markup).toContain("How many a day?");
  });

  it("edits nothing: no Edit, no Remove, no wizard", async () => {
    const markup = await render();

    // "Read-only lens" is the ruling's own phrase, and this is it as a property. The
    // controls the rules table carries on every row are the ones that must NOT be here.
    expect(markup).not.toContain("qcms-rule-action");
    expect(markup).not.toContain("<button");
  });

  it("tags a rule that carries issues, and says nothing about one that does not", async () => {
    const withIssue = await render(DRAFT, [ISSUE]);
    const clean = await render(DRAFT, []);

    expect(withIssue).toContain('data-rule-issues="1"');
    // Silence rather than a zero. An empty verdict and an absent one both arrive here as
    // no issues, and neither is evidence that a rule is clean.
    expect(clean).not.toContain("data-rule-issues");
  });

  it("counts the rules, which is a count no other panel on the screen makes", async () => {
    // `plan/admin-ux-audit.md` §5.6 objects to two overlapping counts on one screen. This
    // one counts RULES; the validation panel counts ISSUES and stays the only thing that
    // does.
    expect(await render()).toContain('data-rule-count="1"');
    expect(await render()).toContain("1 rule");
  });

  it("says a form has no rules rather than rendering an empty list", async () => {
    const markup = await render({ ...DRAFT, rules: [] });

    expect(markup).toContain("No rules yet");
    expect(markup).toContain('data-rule-count="0"');
    // The way through is still offered: a form with no rules is the form that most needs
    // the Add rule link.
    expect(hrefs(markup)).toContain(`${rulesHref(FORM_ID)}#new-rule`);
  });

  it("withholds Add rule, and says why, when the form pins nothing to read", async () => {
    const markup = await render({ ...DRAFT, steps: [], rules: [] });

    // A condition has to read a question, so the rules screen would refuse. Absent rather
    // than disabled: a disabled link is not a control any browser offers, and the sentence
    // in its place is what tells an author what to do first.
    expect(hrefs(markup)).not.toContain(`${rulesHref(FORM_ID)}#new-rule`);
    expect(markup).toContain("Pin a question first");
    // "Edit rules" survives, because reading them is not adding one.
    expect(hrefs(markup)).toContain(rulesHref(FORM_ID));
  });
});
