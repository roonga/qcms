import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ruleHref, rulesHref } from "../../lib/forms/issues.ts";
import type { DraftForm, FormIssue, PinnableQuestion } from "../../lib/forms/types.ts";
import type { ReadState } from "../../lib/read-state.ts";

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

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

function buttonClasses(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*class="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

describe("the builder's rules lens", () => {
  it("addresses every rule by route AND fragment, never by a bare fragment", async () => {
    const markup = await render();

    expect(hrefs(markup)).toContain(ruleHref(FORM_ID, "rul_smoker_daily"));
    expect(
      hrefs(markup).filter((href) => href.startsWith("#")),
      "a bare fragment resolves to nothing once the rules are a route away",
    ).toStrictEqual([]);
  });

  it("offers a way to the rules screen and a way to add a rule, both as routes", async () => {
    const markup = await render();

    expect(hrefs(markup)).toContain(rulesHref(FORM_ID));
    expect(hrefs(markup)).toContain(`${rulesHref(FORM_ID)}#new-rule`);
  });

  it("states each rule as the same sentence the rules table states", async () => {
    const markup = await render();

    expect(markup).toContain("Do you smoke?");
    expect(markup).toContain("How many a day?");
  });

  it("edits nothing: no Edit, no Remove, no wizard", async () => {
    const markup = await render();

    expect(markup).not.toContain("qcms-rule-action");
    expect(buttonClasses(markup), "the help trigger is the only button").toEqual([
      "qcms-round qcms-help__button",
    ]);
  });

  it("tags a rule that carries issues, and says nothing about one that does not", async () => {
    const withIssue = await render(DRAFT, [ISSUE]);
    const clean = await render(DRAFT, []);

    expect(withIssue).toContain('data-rule-issues="1"');
    expect(clean).not.toContain("data-rule-issues");
  });

  it("counts the rules, which is a count no other panel on the screen makes", async () => {
    expect(await render()).toContain('data-rule-count="1"');
    expect(await render()).toContain("1 rule");
  });

  it("says a form has no rules rather than rendering an empty list", async () => {
    const markup = await render({ ...DRAFT, rules: [] });

    expect(markup).toContain("No rules yet");
    expect(markup).toContain('data-rule-count="0"');
    expect(hrefs(markup)).toContain(`${rulesHref(FORM_ID)}#new-rule`);
  });

  it("withholds Add rule, and says why, when the form pins nothing to read", async () => {
    const markup = await render({ ...DRAFT, steps: [], rules: [] });

    expect(hrefs(markup)).not.toContain(`${rulesHref(FORM_ID)}#new-rule`);
    expect(markup).toContain("Pin a question first");
    expect(hrefs(markup)).toContain(rulesHref(FORM_ID));
  });
});
