import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DraftForm, FormSettings, PinnableQuestion } from "../../lib/forms/types.ts";
import { stripTags } from "../test-support/markup.ts";

/* Facts in a disclosure summary must also exist inside its panel; collapsed content leaves the
   accessibility tree. */

const { t } = await import("../../lib/i18n/en.ts");
const { FormSettingsPanel } = await import("./form-settings-panel.tsx");
const { RuleTestBench } = await import("./rule-test-bench.tsx");

const BENCH_HEADING =
  /<section[^>]*aria-labelledby="qcms-bench-heading"[\s\S]*?<h3[^>]*id="qcms-bench-heading"/;

const SETTINGS_HEADING =
  /<section[^>]*aria-labelledby="qcms-settings-heading"[\s\S]*?<h2[^>]*id="qcms-settings-heading"/;

function decodeEntities(html: string): string {
  return html
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function renderSettings(
  settings: FormSettings,
  challengeEnforceable = false,
  saveError: string | undefined = undefined,
): string {
  return decodeEntities(
    renderToStaticMarkup(
      <FormSettingsPanel
        settings={settings}
        challengeEnforceable={challengeEnforceable}
        saveError={saveError}
        onChange={() => undefined}
      />,
    ),
  );
}

function textOfTestId(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`, "s").exec(html);
  expect(match, `the render carries a ${testId} element`).not.toBeNull();
  return stripTags(match?.[1] ?? "");
}

function countTestId(html: string, testId: string): number {
  return [...html.matchAll(new RegExp(`data-testid="${testId}"`, "g"))].length;
}

describe("the form settings panel's summary (issue 519)", () => {
  it("heads the panel with an h2, so it has an entry in the heading outline", () => {
    const html = renderSettings({ challengeRequired: false, minSubmitMs: null });

    expect(html).toMatch(SETTINGS_HEADING);
    expect(html).toContain(t("forms.settings.title"));
    expect(html, "and it is not a disclosure any more").not.toContain("<summary");
  });

  it("states the two switches as facts, with no judgement and no save claim", () => {
    const digest = textOfTestId(
      renderSettings({ challengeRequired: true, minSubmitMs: 800 }),
      "qcms-settings-digest",
    );

    expect(digest).toContain(t("forms.settings.digest.challengeOn"));
    expect(digest).toContain("800");
    const wholePanel = stripTags(
      renderSettings({ challengeRequired: true, minSubmitMs: 800 }),
    ).toLowerCase();
    expect(wholePanel, "no save control").not.toContain("save settings");
    expect(wholePanel, "and no save confirmation").not.toContain("saved");
  });

  it("warns only when a required challenge cannot be enforced here", () => {
    const required = { challengeRequired: true, minSubmitMs: null };
    const off = { challengeRequired: false, minSubmitMs: null };

    const warned = renderSettings(required, false);
    expect(countTestId(warned, "qcms-challenge-unenforceable")).toBe(1);
    expect(warned).toContain(t("forms.settings.challengeUnenforceable"));

    expect(countTestId(renderSettings(required, true), "qcms-challenge-unenforceable")).toBe(0);
    expect(countTestId(renderSettings(off, false), "qcms-challenge-unenforceable")).toBe(0);
    expect(countTestId(renderSettings(off, true), "qcms-challenge-unenforceable")).toBe(0);

    expect(stripTags(warned).toLowerCase()).not.toContain("set to none");
  });

  it("says a settings save that was refused, in a live region that was already there", () => {
    const html = renderSettings(
      { challengeRequired: true, minSubmitMs: null },
      false,
      "The minimum time may not exceed one hour.",
    );

    expect(textOfTestId(html, "qcms-settings-state")).toContain(
      "The minimum time may not exceed one hour.",
    );
    const quiet = renderSettings({ challengeRequired: true, minSubmitMs: null });
    expect(quiet).toContain('data-testid="qcms-form-settings-status"');
    expect(quiet).toContain('aria-live="polite"');
    expect(countTestId(quiet, "qcms-settings-state"), "and it is silent until it is not").toBe(0);
  });

  it("keeps every digested fact inside the panel as well (§3.7)", () => {
    const html = renderSettings({ challengeRequired: true, minSubmitMs: 800 });
    const digest = textOfTestId(html, "qcms-settings-digest");
    const body = html.slice(html.indexOf("qcms-settings-digest"));

    expect(digest).toContain("800");
    expect(body).toMatch(/<input[^>]*value="800"/);
    expect(digest).toContain(t("forms.settings.digest.challengeOn"));
    expect(body).toContain(t("forms.settings.challengeRequired"));
    expect(body).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
  });

  it("says the deployment default is in force when no override is set, and shows no field", () => {
    const html = renderSettings({ challengeRequired: false, minSubmitMs: null });
    const digest = textOfTestId(html, "qcms-settings-digest");
    const body = html.slice(html.indexOf("qcms-settings-digest"));

    expect(digest).toContain(t("forms.settings.digest.minSubmitDefault"));
    expect(digest).toContain(t("forms.settings.digest.challengeOff"));
    expect(body).toContain(t("forms.settings.minSubmitDefault"));
    expect(body).not.toContain(t("forms.settings.minSubmit"));
  });
});

const CHOICE: PinnableQuestion = {
  questionId: "q_colour",
  slug: "colour",
  label: { en: "Colour" },
  type: "singleChoice",
  versions: [
    {
      version: 1,
      status: "published",
      definition: {
        questionId: "q_colour",
        type: "singleChoice",
        label: { en: "Colour" },
        options: [
          { optionId: "opt_red", label: { en: "Red" } },
          { optionId: "opt_blue", label: { en: "Blue" } },
        ],
      },
    },
  ],
};

const COUNT: PinnableQuestion = {
  questionId: "q_count",
  slug: "count",
  label: { en: "Count" },
  type: "number",
  versions: [
    {
      version: 1,
      status: "published",
      definition: { questionId: "q_count", type: "number", label: { en: "Count" } },
    },
  ],
};

const DRAFT: DraftForm = {
  formId: "frm_test",
  defaultLocale: "en",
  title: { en: "Test" },
  steps: [
    {
      stepId: "stp_one",
      title: { en: "One" },
      items: [
        { questionId: "q_colour", version: 1 },
        { questionId: "q_count", version: 1 },
      ],
    },
  ],
  rules: [
    {
      ruleId: "rul_two_reads",
      when: {
        op: "and",
        conditions: [
          { op: "equals", questionId: "q_colour", value: "opt_red" },
          { op: "gt", questionId: "q_count", value: 2 },
        ],
      },
      show: ["q_count"],
    },
  ],
};

function renderBench(draft: DraftForm): string {
  const rule = draft.rules[0];
  if (rule === undefined) throw new Error("the bench fixture needs a rule to be about");
  return decodeEntities(
    renderToStaticMarkup(
      <RuleTestBench
        draft={draft}
        rule={rule}
        library={{ ok: true, data: [CHOICE, COUNT] }}
        previewCondition={() => Promise.resolve({ status: "idle" as const })}
      />,
    ),
  );
}

describe("the rule test bench's summary (issue 519)", () => {
  it("heads the panel with a heading, one level under the dialog that holds it", () => {
    expect(renderBench(DRAFT)).toMatch(BENCH_HEADING);
    expect(renderBench(DRAFT), "and it is not a disclosure any more").not.toContain("<summary");
    expect(renderBench(DRAFT)).toContain(t("forms.bench.title"));
  });

  it("counts the questions the loaded rule reads, and the panel renders that many", () => {
    const html = renderBench(DRAFT);
    const digest = textOfTestId(html, "qcms-bench-digest");

    expect(digest).toContain("rul_two_reads");
    expect(digest).toContain(t("forms.bench.digest.questionOther", { count: 2 }));
    expect(countTestId(html, "qcms-bench-reference")).toBe(2);
  });

  it("states no issue count, because the validation panel owns the screen's only one", () => {
    const digest = textOfTestId(renderBench(DRAFT), "qcms-bench-digest");

    expect(digest).not.toContain(t("forms.validation.title"));
    expect(digest).not.toMatch(/issue/i);
  });

  it("states no outcome, because a verdict exists only after a run", () => {
    const digest = textOfTestId(renderBench(DRAFT), "qcms-bench-digest");

    expect(digest).not.toContain(t("forms.bench.match"));
    expect(digest).not.toContain(t("forms.bench.noMatch"));
    expect(digest).not.toContain(t("forms.bench.unavailable"));
  });

  it("is about one rule, never the draft's others (Code Owner, 2026-08-30)", () => {
    const sibling = { ruleId: "rul_unrelated", when: DRAFT.rules[0]!.when, show: ["q_colour"] };
    const html = renderBench({ ...DRAFT, rules: [DRAFT.rules[0]!, sibling] });

    expect(textOfTestId(html, "qcms-bench-digest")).toContain("rul_two_reads");
    expect(html, "no other rule of the draft is reachable from the bench").not.toContain(
      "rul_unrelated",
    );
  });
});
