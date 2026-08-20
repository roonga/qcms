import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DraftForm, FormSettings, PinnableQuestion } from "../../lib/forms/types.ts";

/**
 * Issue 519: the builder's two `<details>` panels get a heading and a digest.
 *
 * `plan/admin-ux-audit.md` §4.3 found that neither the Settings panel nor the Test bench
 * had an entry in the heading outline, because a bare `<summary>` is not a heading while
 * every other section of the same page carries an `h2`. §3.7 then adds the digest, with
 * one rule that binds harder than the digest itself:
 *
 * > A collapsed `<details>` is removed from the accessibility tree entirely, so a fact
 * > stated in the summary must ALSO exist inside the panel. The summary may never be the
 * > only place a value lives.
 *
 * ## Why this layer, and why these assertions
 *
 * That rule is a relationship between two parts of one render, and it is the part a later
 * edit breaks silently: deleting a control, or changing what the digest reads from, leaves
 * a screen that still looks right and still has a digest, but whose digest has quietly
 * become the sole copy of a number. Nothing in a browser notices that - axe reads a tree,
 * and an e2e that opens the panel sees both copies without comparing them.
 *
 * So the assertions are deliberately about the LINK rather than about the sentence: the
 * millisecond figure the digest states is asserted to be the value the panel's own number
 * field carries, and the challenge phrase the digest chose is asserted against the checked
 * state of the panel's own checkbox. The real catalog and the real kit components are used
 * for that reason - stubs would only prove the stubs agree with each other.
 *
 * ## Red-first
 *
 * Against the pre-change JSX (`red-vitest.log`): every heading assertion fails (the
 * summaries held a bare string, so `<summary><h2` appears nowhere), and every digest
 * assertion fails on a missing `data-testid`. `docs/gates/pr-519/` carries the visual half.
 */

/** The `@/` alias is a Next/tsconfig path; Vitest resolves nothing for it (task 001). */
vi.mock("@/components/kit", () => import("../kit.tsx"));
vi.mock("@/lib/forms/builder-state", () => import("../../lib/forms/builder-state.ts"));
vi.mock("@/lib/forms/condition", () => import("../../lib/forms/condition.ts"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));

const { t } = await import("../../lib/i18n/en.ts");
const { FormSettingsPanel } = await import("./form-settings-panel.tsx");
const { RuleTestBench } = await import("./rule-test-bench.tsx");

/** The heading level every other section of the builder page uses (steps, rules, validation). */
const SUMMARY_HEADING = /<summary[^>]*><h2[^>]*>/;

/**
 * React escapes text nodes, so a catalog sentence carrying an apostrophe reaches the
 * markup as a numeric character reference and a plain `toContain` misses it. Decoding is
 * the honest direction: the assertions are about the sentence a reader gets, not about
 * which of the two equivalent encodings React happened to emit.
 */
function decodeEntities(html: string): string {
  return html
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function renderSettings(settings: FormSettings, challengeProvider = "none"): string {
  return decodeEntities(
    renderToStaticMarkup(
      <FormSettingsPanel
        settings={settings}
        challengeProvider={challengeProvider}
        updateSettings={() => Promise.resolve({ status: "idle" as const })}
      />,
    ),
  );
}

/** The text of one marked element, with tags inside it stripped. */
function textOfTestId(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`, "s").exec(html);
  expect(match, `the render carries a ${testId} element`).not.toBeNull();
  return (match?.[1] ?? "").replaceAll(/<[^<>]+>/g, "");
}

/** How many elements carry a given test id. */
function countTestId(html: string, testId: string): number {
  return [...html.matchAll(new RegExp(`data-testid="${testId}"`, "g"))].length;
}

describe("the form settings panel's summary (issue 519)", () => {
  it("puts an h2 inside the summary, so the panel has an entry in the heading outline", () => {
    const html = renderSettings({ challengeRequired: false, minSubmitMs: null });

    expect(html).toMatch(SUMMARY_HEADING);
    expect(html).toContain(t("forms.settings.title"));
  });

  it("states the two switches as facts, with no judgement and no save claim", () => {
    const digest = textOfTestId(
      renderSettings({ challengeRequired: true, minSubmitMs: 800 }),
      "qcms-settings-digest",
    );

    expect(digest).toContain(t("forms.settings.digest.challengeOn"));
    expect(digest).toContain("800");
    // `plan/admin-design-contracts.md` §6: the builder states its save model exactly once,
    // in the ambient strip. A digest that said "saved" or "unsaved" would be a second.
    expect(digest).not.toContain(t("forms.settings.saved"));
    expect(digest).not.toContain(t("forms.settings.save"));
  });

  it("keeps every digested fact inside the panel as well (§3.7)", () => {
    const html = renderSettings({ challengeRequired: true, minSubmitMs: 800 });
    const digest = textOfTestId(html, "qcms-settings-digest");
    const body = html.slice(html.indexOf("</summary>"));

    // The millisecond figure the summary states is the number field's own value, so
    // opening the panel finds it again rather than losing it.
    expect(digest).toContain("800");
    expect(body).toMatch(/<input[^>]*value="800"/);
    // And the challenge phrase is the checkbox's own state.
    expect(digest).toContain(t("forms.settings.digest.challengeOn"));
    expect(body).toContain(t("forms.settings.challengeRequired"));
    expect(body).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
  });

  it("says the deployment default is in force when no override is set, and shows no field", () => {
    const html = renderSettings({ challengeRequired: false, minSubmitMs: null });
    const digest = textOfTestId(html, "qcms-settings-digest");
    const body = html.slice(html.indexOf("</summary>"));

    expect(digest).toContain(t("forms.settings.digest.minSubmitDefault"));
    expect(digest).toContain(t("forms.settings.digest.challengeOff"));
    // The fact behind that phrase inside the panel is the "use the deployment's minimum
    // time" checkbox being ticked, which is also why there is no millisecond field to read.
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
  return decodeEntities(
    renderToStaticMarkup(
      <RuleTestBench
        draft={draft}
        rules={draft.rules}
        library={[CHOICE, COUNT]}
        previewCondition={() => Promise.resolve({ status: "idle" as const })}
      />,
    ),
  );
}

describe("the rule test bench's summary (issue 519)", () => {
  it("puts an h2 inside the summary, at the same level as the panel beside it", () => {
    expect(renderBench(DRAFT)).toMatch(SUMMARY_HEADING);
    expect(renderBench(DRAFT)).toContain(t("forms.bench.title"));
  });

  it("counts the questions the loaded rule reads, and the panel renders that many", () => {
    const html = renderBench(DRAFT);
    const digest = textOfTestId(html, "qcms-bench-digest");

    expect(digest).toContain("rul_two_reads");
    expect(digest).toContain(t("forms.bench.digest.questionOther", { count: 2 }));
    // §3.7: the count in the summary is a count of entries that exist inside the panel,
    // which is the shape the audit explicitly blesses ("the count in the summary plus the
    // entries inside is fine").
    expect(countTestId(html, "qcms-bench-reference")).toBe(2);
  });

  it("states no issue count, because the validation panel owns the screen's only one", () => {
    const digest = textOfTestId(renderBench(DRAFT), "qcms-bench-digest");

    // §5.6. The POC's mistake was two collapsed digests counting overlapping sets; the
    // only count this digest carries is of questions read, which nothing else counts.
    expect(digest).not.toContain(t("forms.validation.title"));
    expect(digest).not.toMatch(/issue/i);
  });

  it("states no outcome, because a verdict exists only after a run", () => {
    const digest = textOfTestId(renderBench(DRAFT), "qcms-bench-digest");

    // "Not run yet" would be a fact living in the summary and nowhere else, which is the
    // exact shape §3.7 forbids: collapse the panel and the only copy is gone.
    expect(digest).not.toContain(t("forms.bench.match"));
    expect(digest).not.toContain(t("forms.bench.noMatch"));
    expect(digest).not.toContain(t("forms.bench.unavailable"));
  });

  it("says there is nothing to try when the draft has no rules, and the panel agrees", () => {
    const html = renderBench({ ...DRAFT, rules: [] });

    expect(textOfTestId(html, "qcms-bench-digest")).toBe(t("forms.bench.digest.noRules"));
    expect(html.slice(html.indexOf("</summary>"))).toContain(t("forms.bench.noRules"));
  });
});
