import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DraftForm, FormSettings, PinnableQuestion } from "../../lib/forms/types.ts";
import { stripTags } from "../test-support/markup.ts";

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
 * The assertions fail if summary headings or digest test identifiers are removed.
 */

/** The `@/` alias is a Next/tsconfig path; Vitest resolves nothing for it (task 001). */
vi.mock("@/components/kit", () => import("../kit.tsx"));
vi.mock("@/lib/forms/builder-state", () => import("../../lib/forms/builder-state.ts"));
vi.mock("@/lib/forms/condition", () => import("../../lib/forms/condition.ts"));
vi.mock("@/components/searchable-select", () => import("../searchable-select.tsx"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));

const { t } = await import("../../lib/i18n/en.ts");
const { FormSettingsPanel } = await import("./form-settings-panel.tsx");
const { RuleTestBench } = await import("./rule-test-bench.tsx");

/** The heading level every other section of the builder page uses (steps, rules, validation). */
/*
 * There was a `SUMMARY_HEADING` here, matching an `h2` inside a `<summary>`. Neither of the
 * two panels this file covers is a disclosure any more - the settings stopped being one on
 * 2026-08-26 and the bench on 2026-08-29, each when it was left alone on a screen of its
 * own - so nothing in this app has that shape and the pattern matched nothing. Issue 519's
 * claim survives both moves and is asserted through the two heading patterns below: a panel
 * has an entry in the heading outline.
 */

/**
 * The settings panel is no longer a disclosure (Code Owner, 2026-08-26): it shared the
 * form's screen with four other panels and something had to give way, and that screen
 * carries the settings and little else now. Its heading is a plain `h2` labelling a
 * `section` rather than one inside a `summary`.
 *
 * The claim issue 519 made survives the change and is what is still asserted: the panel has
 * an entry in the heading outline. It was a `<summary>` with no heading in it that 519
 * fixed, and a section with a heading is no more at risk of that than a details was.
 */
/*
 * AN `h3` SINCE 2026-08-30, and the level is the claim rather than an incidental. The bench
 * is the third phase of the rule wizard now, and a modal `aria-hidden`s the rest of the
 * document: the outline a reader navigates inside the dialog starts at the dialog's own
 * `<h3>` title, so an `h2` under it would be a level this dialog does not have.
 * `e2e/a11y-axe.pw.ts` runs `heading-order` over the open dialog, which is what makes that
 * a checked claim. Issue 519's claim - the panel has an entry in the outline - is unchanged.
 */
const BENCH_HEADING =
  /<section[^>]*aria-labelledby="qcms-bench-heading"[\s\S]*?<h3[^>]*id="qcms-bench-heading"/;

const SETTINGS_HEADING =
  /<section[^>]*aria-labelledby="qcms-settings-heading"[\s\S]*?<h2[^>]*id="qcms-settings-heading"/;

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

/** The text of one marked element, with tags inside it stripped. */
function textOfTestId(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`, "s").exec(html);
  expect(match, `the render carries a ${testId} element`).not.toBeNull();
  return stripTags(match?.[1] ?? "");
}

/** How many elements carry a given test id. */
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
    // `plan/admin-design-contracts.md` §6: the builder states its save model exactly once,
    // in the ambient strip. A digest that said "saved" or "unsaved" would be a second.
    //
    // Asserted over the whole panel rather than the digest alone since the 2026-08-29
    // amendment, because the sentences this is guarding against no longer exist as catalog
    // keys to name: the settings autosave, so "Save settings" and "Settings saved." were
    // deleted rather than merely kept out of the summary. Matching the words is what
    // notices either of them being written back in, under any key.
    const wholePanel = stripTags(
      renderSettings({ challengeRequired: true, minSubmitMs: 800 }),
    ).toLowerCase();
    expect(wholePanel, "no save control").not.toContain("save settings");
    expect(wholePanel, "and no save confirmation").not.toContain("saved");
  });

  // ADR-24 as amended (issue #725): the panel is handed a behaviour,
  // `challengeEnforceable`, and no longer a provider name it compares against
  // `"none"`. The warning is a function of that boolean and the checkbox, in all
  // four combinations, and no provider string reaches the render at all.
  it("warns only when a required challenge cannot be enforced here", () => {
    const required = { challengeRequired: true, minSubmitMs: null };
    const off = { challengeRequired: false, minSubmitMs: null };

    const warned = renderSettings(required, false);
    expect(countTestId(warned, "qcms-challenge-unenforceable")).toBe(1);
    expect(warned).toContain(t("forms.settings.challengeUnenforceable"));

    // A deployment that can check a challenge has nothing to warn about.
    expect(countTestId(renderSettings(required, true), "qcms-challenge-unenforceable")).toBe(0);
    // Nor has a form that is not asking for one, enforceable or not.
    expect(countTestId(renderSettings(off, false), "qcms-challenge-unenforceable")).toBe(0);
    expect(countTestId(renderSettings(off, true), "qcms-challenge-unenforceable")).toBe(0);

    // And the sentence states the deployment's behaviour rather than the flag's
    // value: "none" is a provider name and has no business on this screen.
    expect(stripTags(warned).toLowerCase()).not.toContain("set to none");
  });

  it("says a settings save that was refused, in a live region that was already there", () => {
    // The settings autosave since 2026-08-29, so there is no press to report a refusal
    // back to. This sentence is the whole of what stands between an author and the belief
    // that a deployment switch is set when the API declined to set it.
    const html = renderSettings(
      { challengeRequired: true, minSubmitMs: null },
      false,
      "The minimum time may not exceed one hour.",
    );

    expect(textOfTestId(html, "qcms-settings-state")).toContain(
      "The minimum time may not exceed one hour.",
    );
    // MOUNTED EITHER WAY, which is the part a rendered tree hides. `aria-live` announces a
    // change inside a region that was already in the tree; a region that arrives with its
    // first sentence usually announces nothing, and axe cannot see the difference.
    const quiet = renderSettings({ challengeRequired: true, minSubmitMs: null });
    expect(quiet).toContain('data-testid="qcms-form-settings-status"');
    expect(quiet).toContain('aria-live="polite"');
    expect(countTestId(quiet, "qcms-settings-state"), "and it is silent until it is not").toBe(0);
  });

  it("keeps every digested fact inside the panel as well (§3.7)", () => {
    const html = renderSettings({ challengeRequired: true, minSubmitMs: 800 });
    const digest = textOfTestId(html, "qcms-settings-digest");
    // Everything after the digest is the panel's body. It used to be everything after
    // `</summary>`; the panel stopped being a disclosure on 2026-08-26, and §3.7's claim -
    // that a digested fact also exists as a control inside the panel - is about the two
    // being consistent rather than about one of them being hidden.
    const body = html.slice(html.indexOf("qcms-settings-digest"));

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
    // Everything after the digest is the panel's body. It used to be everything after
    // `</summary>`; the panel stopped being a disclosure on 2026-08-26, and §3.7's claim -
    // that a digested fact also exists as a control inside the panel - is about the two
    // being consistent rather than about one of them being hidden.
    const body = html.slice(html.indexOf("qcms-settings-digest"));

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

/** The bench takes the one rule the wizard is editing, so the fixture hands it that one. */
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
    // The bench stopped being a disclosure on 2026-08-29 and became a phase of the rule
    // wizard on 2026-08-30. 519's claim survives both and is what is asserted: the panel
    // has an entry in the heading outline.
    expect(renderBench(DRAFT)).toMatch(BENCH_HEADING);
    expect(renderBench(DRAFT), "and it is not a disclosure any more").not.toContain("<summary");
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

  it("is about one rule, never the draft's others (Code Owner, 2026-08-30)", () => {
    // The bench used to take every rule in the draft and offer a `Select` to choose
    // between them. It is the Test phase of the rule wizard now, so the rule is already
    // decided by whichever row's Edit was pressed, and a second rule in the same draft
    // must leave no trace here - not in the digest, and not in a picker.
    const sibling = { ruleId: "rul_unrelated", when: DRAFT.rules[0]!.when, show: ["q_colour"] };
    const html = renderBench({ ...DRAFT, rules: [DRAFT.rules[0]!, sibling] });

    expect(textOfTestId(html, "qcms-bench-digest")).toContain("rul_two_reads");
    expect(html, "no other rule of the draft is reachable from the bench").not.toContain(
      "rul_unrelated",
    );
  });
});
