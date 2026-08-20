import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { generate } from "otplib";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  accountTrigger,
  activeElementId,
  appearanceTrigger,
  fillStable,
  openMenu,
  readSetupKey,
  settleTransitions,
  signInWithTotp,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  pinQuestion,
  rule,
  toggleCheckbox,
  toggleTarget,
  waitForSaved,
} from "./support/forms.js";
import { openDeliverer, submitResponse, TestConsumer } from "./support/ops.js";
import {
  addOption,
  chooseType,
  confirmLifecycle,
  createDraft,
  field,
  fillDate,
  grip,
  optionIds,
  pendingRow,
} from "./support/questions.js";

/**
 * The admin's axe gate (task 031, exit criterion 5; policies inherited from task 030).
 *
 * Zero violations is the gate, and it runs on **every state the shell and the auth loop
 * have**, not just the first page: the signed-out screen, each failure state, the enrollment
 * screen with its QR and setup key, the one-time recovery-code display, the challenge and
 * its recovery variant, and all five shell areas. Two of those are the ones a
 * first-render-only gate would miss, and they are exactly where this app's accessibility
 * risk concentrates: an alert that has to receive focus, and a list of codes that has to be
 * announced as a list. (The gate has already earned its place once: it caught a duplicate
 * `role="alert"` created by wrapping the vendored `Alert` in a second live region.)
 *
 * It runs inside the one root Playwright config, which CI's browser job executes in full
 * (`pnpm exec playwright test`), so the gate is CI-enforced by construction rather than by a
 * separate job someone has to remember to add - the failure mode 029 shipped and 030 had to
 * fix (docs/RETRO.md).
 *
 * `color-contrast` is enabled here, unlike in the jsdom component tests where no canvas
 * exists to measure it: this is a real browser, and the app's Cobalt palette against the
 * shared neutrals is precisely the pair worth checking.
 *
 * ## Every state, in every mode (task 055, exit criterion 5)
 *
 * `color-contrast` is the one axe rule whose answer depends on the mode, and it is
 * exactly the rule an operator relies on, so running the gate only in the mode the test
 * machine happens to prefer would leave two thirds of the palette unchecked. Each state is
 * therefore analysed three times.
 *
 * The mode is applied by setting the root class directly rather than by re-navigating with
 * a cookie, and the saving is the point: the class is the only input the palette has, and a
 * re-navigation per mode would triple the sign-ins and page loads in this file to measure
 * the same pixels. That the class arrives correctly from a cookie, from
 * `prefers-color-scheme`, and from the control itself is proved in `appearance.pw.ts`,
 * which is where that mechanism belongs.
 *
 * Each test signs in for itself: Playwright gives every test a fresh browser context, and
 * sharing one would disable the shared console gate (see `support/flow.ts`).
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("a11y");

/** Set by the enrollment test; stable once the factor is confirmed. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The seeded insurance form the operations sweep uses (see `responses-ops.pw.ts`). */
const OPS_SLUG = "auto";
const OPS_FORM_ID = "frm_auto_quote";

/**
 * The form the publish sweep authors and publishes, handed to the operations sweep.
 *
 * The webhook half of the operations sweep runs against **this** form rather than the
 * seeded one, and that is a hard requirement rather than a preference (issue #306). It
 * has to make real deliveries succeed, fail, dead-letter and be redelivered in order
 * to render the three `DeliveryStatusTag` tints, and `responses-ops.pw.ts` asserts
 * exact per-status row counts on the seeded form's dashboard. Two specs writing
 * delivery rows for one form would make each other's counts unreadable; a form of this
 * sweep's own keeps both honest.
 *
 * Serial mode is what makes the handover legal, exactly as it is for `totpSecret`
 * above: the publishing test is declared before the operations test and therefore runs
 * before it. Filtering with `-g` breaks that, which is already true of this file.
 */
let pubForm: {
  readonly formId: string;
  readonly slug: string;
  readonly choiceId: string;
  readonly choiceOption: string;
  readonly countId: string;
} | null = null;

/**
 * A consumer response body tall enough to overflow `.qcms-snippet`'s 12rem cap.
 *
 * The overflow is the point, not decoration: a scroll container that no keyboard can
 * reach is a WCAG 2.1.1 failure (issue #309), and axe only reports
 * `scrollable-region-focusable` on an element that actually scrolls. A short body
 * would render the same markup and prove nothing. Kept under the deliverer's
 * `RESPONSE_SNIPPET_MAX` (500) so what is stored is what is shown, and made of many
 * short lines rather than one long one because `white-space: pre-wrap` is what turns
 * them into height.
 */
const TALL_RESPONSE_BODY = `{\n${Array.from(
  { length: 22 },
  (_, index) => `  "line_${String(index)}": "x"`,
).join(",\n")}\n}`;

/** WCAG 2.2 AA, the same rule set the portal gate uses. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Rules run **in addition** to the tag set above (issue #511).
 *
 * `heading-order` carries no wcag tag at all: axe classifies it as best-practice,
 * because a skipped level is a defect no success criterion states in those words. That
 * classification is why an erased response could render `<h1>` then `<h3>` through every
 * mode of this gate without a word of complaint. The heading outline is the structure a
 * screen-reader user navigates an admin screen by, so a hole in it is a real defect here
 * whatever tag axe files it under.
 *
 * `runOnly` and `rules` are set in one `options()` call rather than by chaining
 * `withTags`: `AxeBuilder#options` **replaces** its accumulated option object, so
 * `.withTags(...).options(...)` would silently drop the tags, and `withRules` is
 * documented as mutually exclusive with `withTags`. Inside axe-core an explicit
 * `rules[id].enabled` is consulted before the `runOnly` tag filter, which is what lets a
 * tagless rule join a tag-selected run.
 */
const EXTRA_RULES = { "heading-order": { enabled: true } };

/**
 * The heading-order gaps that already existed on the day the rule was switched on
 * (issue #511), keyed by the state they appear in and by the node axe names.
 *
 * Switching a best-practice rule on over a codebase that has never been measured by it
 * surfaces history as well as regressions, and there are exactly two here. Neither is in
 * #511's territory, and how far to go in fixing them is a scope call for the Code Owner
 * rather than something to decide inside a heading fix, so they are recorded rather than
 * silently dropped and rather than left failing:
 *
 * - `version history`: `components/forms/version-history.tsx` heads its compare panel
 *   with an `<h3>` directly under the page `<h1>`, with no `<h2>` between.
 * - `the delivery-detail disclosure`: `components/ops/delivery-dashboard.tsx` heads the
 *   expanded row's request headers with an `<h4>` under the dashboard's `<h2>`.
 *
 * This list is a debt register, not a policy: each entry is a defect that should be
 * fixed and the entry deleted, and it is deliberately keyed narrowly (state **and**
 * node) so it cannot grow into a blanket mute. A NEW gap in either of these two states,
 * on any other node, still fails.
 */
const KNOWN_HEADING_ORDER_GAPS: Readonly<Record<string, readonly string[]>> = {
  "version history": ["#qcms-diff-heading"],
  "the delivery-detail disclosure": ["h4:nth-child(1)"],
};

/** The sheet's three mode layers. Light is the bare root, so it has no class. */
const MODES = [
  { name: "light", rootClass: "" },
  { name: "dark", rootClass: "dark" },
  { name: "high-contrast", rootClass: "hc" },
] as const;

async function expectNoViolations(page: Page, state: string): Promise<void> {
  const original = await page.evaluate(() => document.documentElement.className);
  try {
    for (const mode of MODES) {
      await page.evaluate((rootClass) => {
        for (const candidate of ["light", "dark", "hc"]) {
          document.documentElement.classList.remove(candidate);
        }
        if (rootClass !== "") document.documentElement.classList.add(rootClass);
      }, mode.rootClass);
      await settleTransitions(page);

      const results = await new AxeBuilder({ page })
        .options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })
        .analyze();
      // Pre-existing gaps this state is known to carry drop out here, and only for
      // `heading-order` and only on the exact nodes named (issue #511). A violation that
      // names any other node survives the filter with its whole node list intact, so the
      // report still shows the company the new offender was keeping.
      const allowed = KNOWN_HEADING_ORDER_GAPS[state] ?? [];
      const violations = results.violations.filter(
        (v) =>
          v.id !== "heading-order" ||
          v.nodes.some((node) => !allowed.includes(node.target.join(" "))),
      );
      // Name the state, the mode, the rule AND the element in the failure message. An
      // axe failure reported as a bare count costs a second run to diagnose; one
      // reported without the mode costs a third; and a `color-contrast` failure
      // reported without the node and the measured ratio costs a fourth, because the
      // whole point of running per mode is that the offender differs between them.
      expect(
        violations.map(
          (v) =>
            `${v.id}: ${v.help} [${v.nodes
              .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
              .join(" | ")}]`,
        ),
        `axe violations on the ${state} state in ${mode.name}`,
      ).toEqual([]);
    }
  } finally {
    // Leave the page as it was found, so a caller that keeps interacting with it is not
    // silently driving a screen in a mode it never selected.
    await page.evaluate((className) => {
      document.documentElement.className = className;
    }, original);
  }
}

test("the signed-out and failure states have zero violations", async ({ page }) => {
  await page.goto("/sign-in");
  await expectNoViolations(page, "signed-out");

  // The failure state carries a focused alert, which is where an accessible-name, duplicate
  // live region, or focus-order regression would land.
  await page.goto("/sign-in?error=1");
  await expect(page.getByRole("alert")).toBeVisible();
  await expectNoViolations(page, "sign-in error");

  await page.goto("/sign-in?throttled=1");
  await expectNoViolations(page, "sign-in throttled");

  await page.goto("/sign-in?expired=1");
  await expectNoViolations(page, "session expired");
});

test("the enrollment and recovery-code states have zero violations", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  await expectNoViolations(page, "2FA enrollment");

  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);

  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await expectNoViolations(page, "recovery-codes display");
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

test("the authenticated shell states have zero violations", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  for (const path of ["/questions", "/forms", "/responses", "/webhooks", "/settings"]) {
    await page.goto(path);
    await expectNoViolations(page, `shell ${path}`);
  }
});

test("both topbar menus have zero violations while OPEN, in every mode", async ({ page }) => {
  // Task 032. A closed menu is a button; the accessibility risk is entirely in the
  // open state, and a gate that only ever sampled first render would miss all of it:
  // a portalled popover outside the landmark structure, two wordless triggers whose
  // only name is an `aria-label`, and a checked row whose state must not be colour
  // alone. `expectNoViolations` runs each state in light, dark and high contrast, and
  // high contrast is the case that matters most here - it is where a two-colour
  // palette would expose a state carried by colour and nothing else.
  //
  // The mode is chosen through the real control before the sweep, so the CHECKED row
  // is a different row in each pass rather than always the first one.
  await signInWithTotp(page, EMAIL, totpSecret);

  await openMenu(appearanceTrigger(page));
  await expectNoViolations(page, "appearance menu open");

  // Move the check to a different row and sweep again: the checked row's own
  // treatment (glyph, weight, inset edge) is what the "never colour alone"
  // requirement lands on, so it has to be measured where it actually is.
  await page.getByRole("menuitemradio", { name: "High contrast", exact: true }).click();
  await openMenu(appearanceTrigger(page));
  await expectNoViolations(page, "appearance menu open, High contrast checked");
  await page.keyboard.press("Escape");

  await openMenu(accountTrigger(page));
  await expectNoViolations(page, "account menu open");
  await page.keyboard.press("Escape");
});

test("the question library, its editor and a question's detail have zero violations", async ({
  page,
}) => {
  // Task 032, exit criterion 4. These are the app's first screens with real data density -
  // an interactive table, a form with grouped constraint panels, and a modal confirmation -
  // so they are where a label, a group name or a contrast pair is most likely to be missed.
  //
  // `expectNoViolations` runs each state in light, dark and high contrast, so this covers
  // all three modes by construction.
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions");
  await expectNoViolations(page, "question library list");

  await page.goto("/questions/new");
  await expectNoViolations(page, "question editor, empty");

  // A choice type, because that is the shape with the most to get wrong: an option list
  // whose reorder controls have to be distinguishable from one another by name alone.
  await chooseType(page, "Single choice");
  const slug = `a11y-question-${Date.now().toString(36)}`;
  await fillStable(field(page, "Slug"), slug);
  await fillStable(field(page, "Label"), "Which cover applies?");
  await addOption(page, "Comprehensive");
  await addOption(page, "Third party");
  await expectNoViolations(page, "question editor, option list");

  // Task 057, exit criterion 3: the grid analysed with a cell in its EDITING state, which
  // is the state a first-render-only sweep misses. Focusing a label reveals the row's grip
  // and its insert point, so this frame also carries the two controls that are invisible at
  // rest - a contrast failure on either would be invisible to every other run here.
  await field(page, "Option 1 label").focus();
  await expectNoViolations(page, "question editor, option grid with a cell editing");

  // And with the row menu open, which is a popup the grid manages itself rather than one
  // react-aria manages for it.
  await grip(page, 0).focus();
  await grip(page, 0).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expectNoViolations(page, "question editor, option row menu open");
  await page.getByRole("menu").press("Escape");

  // The pending row: a row that exists on screen and carries no option id yet. Its ID cell
  // renders a placeholder rather than an id, and that placeholder is text nobody else
  // checks the contrast of.
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(pendingRow(page)).toBeFocused();
  await expectNoViolations(page, "question editor, ghost row opened and unnamed");
  await pendingRow(page).blur();

  await Promise.all([
    page.waitForURL(/\/questions\/q_/),
    page.getByRole("button", { name: "Create draft" }).click(),
  ]);
  await expectNoViolations(page, "question detail with preview");

  // The confirmation dialog is analysed open: a focus-trapped alertdialog is exactly the
  // state a first-render-only gate would miss.
  await page.getByRole("button", { name: /^Publish version 1$/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "publish confirmation");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: /^Publish version 1$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  // A frozen version renders the same form disabled, which is a different contrast
  // question in every mode than the live one above.
  await expectNoViolations(page, "frozen published version");
});

test("the message and boolean-label fields have zero violations (048)", async ({ page }) => {
  // Task 048, exit criteria 4 and 5. This is a NEW case rather than an extension of the
  // sweep above, and deliberately so: every state that sweep visits carries no constraint
  // and is not required, so the message panel renders its "nothing to write for yet" note
  // and not one message input. The panel's own two risks are only reachable here - a
  // placeholder's contrast against its field in each of the three modes (the thing high
  // contrast is likeliest to get wrong), and nine same-shaped inputs whose accessible names
  // have to distinguish them from one another and from the constraint controls above.
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions/new");
  await chooseType(page, "Short text");
  await fillStable(field(page, "Slug"), `a11y-messages-${Date.now().toString(36)}`);
  await fillStable(field(page, "Label"), "What is your policy number?");
  // Every key a short-text question can carry, plus `required`: four message fields, which
  // is the densest the panel gets.
  await page.getByText("An answer is required", { exact: true }).click();
  await fillStable(field(page, "Shortest answer"), "8");
  await fillStable(field(page, "Longest answer"), "12");
  await fillStable(field(page, "Pattern"), "^[A-Z]{2}[0-9]{6}$");
  // The pattern verdict is announced only because its paragraph is a live region, and
  // nothing else in the suite says so (issue #368, the same defect #359 fixed on the ops
  // surface). Deleting the attribute leaves the element attached, leaves the verdict
  // rendered, and passes axe - which has no rule requiring a live region to exist and can
  // only judge the ones it finds.
  const patternVerdict = page.getByTestId("qcms-pattern-verdict");
  await expect(patternVerdict).toBeAttached();
  await expect(patternVerdict).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "question editor, message fields on their placeholders");

  // And with content in them, because a placeholder and a value are different renderings
  // with different contrast pairs.
  await fillStable(
    field(page, "Message when the answer is too short"),
    "A policy number is 8 characters long.",
  );
  await expectNoViolations(page, "question editor, message fields overridden");

  await page.goto("/questions/new");
  await chooseType(page, "Yes or no");
  await fillStable(field(page, "Slug"), `a11y-bool-labels-${Date.now().toString(36)}`);
  await fillStable(field(page, "Label"), "Were you at fault?");
  await fillStable(field(page, "Label for the affirmative choice"), "I was at fault");
  await expectNoViolations(page, "question editor, boolean label overrides");
});

test("the form builder and the condition editor have zero violations", async ({ page }) => {
  // Task 033, exit criterion 5. The builder is the densest screen the admin has: a
  // navigation rail whose rows carry menus, a modal picker over an interactive table, a
  // recursive tree of grouped controls, a live region that re-announces on every debounce,
  // and a CodeMirror surface whose only accessible name is an attribute. Every one of those
  // is a different way to lose a name or a role, and none of them exists on first render -
  // which is exactly why the sweep walks the states rather than the URL.
  //
  // `expectNoViolations` analyses each state in light, dark and high contrast.
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const run = Date.now().toString(36);
  const choiceSlug = `a11y-cover-${run}`;
  const textSlug = `a11y-notes-${run}`;
  await createDraft(page, choiceSlug, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  const choiceOption = (await optionIds(page))[0] ?? "";
  await createDraft(page, textSlug, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  const choiceId = `q_${choiceSlug.replaceAll("-", "_")}`;
  const textId = `q_${textSlug.replaceAll("-", "_")}`;

  await page.goto("/forms");
  await expectNoViolations(page, "form library");

  await createForm(page, `a11y-form-${run}`, "Accessibility sweep form");
  // A brand-new form has no steps, which is the autosave-paused state and its own layout.
  await expectNoViolations(page, "form builder, empty");

  await addStep(page, "Cover");
  // The library picker is a focus-trapped dialog over an interactive table: the state a
  // first-render-only gate would miss entirely.
  await page.getByRole("button", { name: "Add question from library" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoViolations(page, "library picker dialog");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await pinQuestion(page, choiceId, 1);
  await addStep(page, "Details");
  await pinQuestion(page, textId, 1);
  await waitForSaved(page);
  // The issue count and the save state are announced only because the paragraph holding
  // them is a live region, and nothing else in the suite says so (issue #368). The two
  // spans inside it are attached and carry their text either way, so no content assertion
  // can notice the attribute going missing, and axe cannot either.
  const validationStatus = page.getByTestId("qcms-validation-status");
  await expect(validationStatus).toBeAttached();
  await expect(validationStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "form builder with steps and pins");

  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", choiceOption);
  await toggleTarget(page, ruleId, textId, true);
  await expectNoViolations(page, "condition editor with a complete rule");

  // The flagged state: an inline warning alert beside the picker that raised it, plus the
  // engine's issue rendered at the rule and linked from the panel.
  await toggleTarget(page, ruleId, choiceId, true);
  await expect(page.getByTestId("qcms-backward-flag")).toBeVisible();
  await expect(scope.locator('[data-issue-code="RULE_BACKWARD_TARGET"]')).toBeVisible({
    timeout: 30_000,
  });
  await expectNoViolations(page, "condition editor with a backward target flagged");

  // The two collapsible panels, open: a settings switch with its unenforceable warning, and
  // the read-only test bench with its own live region.
  await page.getByText("Rule test bench").click();
  await toggleCheckbox(page, "Require a challenge before answering", true);
  // Both panels announce their outcome through a live region, and neither was pinned
  // (issue #368). Same reasoning as the validation panel above: attached, populated and
  // axe-clean are all true of a paragraph that has stopped being a live region.
  const settingsStatus = page.getByTestId("qcms-form-settings-status");
  await expect(settingsStatus).toBeAttached();
  await expect(settingsStatus).toHaveAttribute("aria-live", "polite");
  const benchStatus = page.getByTestId("qcms-bench-status");
  await expect(benchStatus).toBeAttached();
  await expect(benchStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "settings panel and rule test bench open");
});

test("publish, preview, history and secure links have zero violations", async ({
  page,
  context,
}) => {
  // Task 034, exit criterion 5. Six of these states do not exist on first render and four
  // of them are dialogs, which is where an accessible name is most easily lost: a
  // confirmation whose body is its `description`, a mint form inside a non-alert dialog, a
  // panel of one-time URLs, and a destructive confirm. The preview and the version view are
  // the shared renderer inside an admin page, so this is also the only place the two
  // stylesheets meet - exactly the pair a contrast rule should be run against.
  //
  // `expectNoViolations` analyses each state in light, dark and high contrast, so twelve
  // states is thirty-six axe runs on top of authoring two questions, building a form and
  // publishing it. Measured at ~50s; the budget is the usual generous multiple of that.
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInWithTotp(page, EMAIL, totpSecret);

  const run = Date.now().toString(36);
  const choiceSlug = `a11y-pub-choice-${run}`;
  const countSlug = `a11y-pub-count-${run}`;
  await createDraft(page, choiceSlug, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  const choiceOption = (await optionIds(page))[0] ?? "";
  await createDraft(page, countSlug, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  const choiceId = `q_${choiceSlug.replaceAll("-", "_")}`;
  const countId = `q_${countSlug.replaceAll("-", "_")}`;

  const slug = `a11y-pub-form-${run}`;
  const formId = await createForm(page, slug, "Publish sweep form");
  await addStep(page, "Cover");
  await pinQuestion(page, choiceId, 1);
  await pinQuestion(page, countId, 1);
  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", choiceOption);
  await toggleTarget(page, ruleId, countId, true);
  await waitForSaved(page);
  await page.reload();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "publish confirmation");
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });
  // That success alert is announced only because the container it arrives in is a live
  // region, and nothing else in the suite says so (issue #368). The visibility assertion
  // directly above passes with the attribute deleted, which is the whole point: the
  // message still appears on screen, it just stops being spoken.
  const publishStatus = page.getByTestId("qcms-form-actions-status");
  await expect(publishStatus).toBeAttached();
  await expect(publishStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "publish success");

  // Published, so respondents can submit to it and its submissions can fan out to a
  // webhook. That is what the operations sweep below needs, and this is the only place
  // in this file that pays for authoring a form (see `pubForm`).
  pubForm = { formId, slug, choiceId, choiceOption, countId };

  // The close confirmation, whose whole body is the R1 explanation.
  await page.getByRole("button", { name: "Close form" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "close-form confirmation");
  await page.keyboard.press("Escape");

  await page.goto(`/forms/${formId}/preview`);
  await expect(
    page.getByTestId("qcms-draft-preview").getByText("E2E Single choice question"),
  ).toBeVisible({
    timeout: 60_000,
  });
  // The preview's loading and error states are announced only because their container is
  // a live region, and nothing else in the suite says so (issue #368).
  const previewStatus = page.getByTestId("qcms-preview-status");
  await expect(previewStatus).toBeAttached();
  await expect(previewStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "draft preview, first step");

  await page.getByTestId("qcms-draft-preview").getByText("Yes, always", { exact: true }).click();
  await expect(page.getByTestId("qcms-draft-preview").getByText("E2E Number question")).toBeVisible(
    { timeout: 30_000 },
  );
  await expectNoViolations(page, "draft preview with a branch revealed");

  await page.goto(`/forms/${formId}/versions`);
  await expect(page.getByRole("grid", { name: "Published versions" })).toBeVisible();
  await expectNoViolations(page, "version history");

  await page.getByRole("link", { name: "View v1" }).click();
  await expect(page.getByTestId("qcms-version-view")).toBeVisible({ timeout: 60_000 });
  await expectNoViolations(page, "one published version, rendered from storage");

  await page.goto(`/forms/${formId}/links`);
  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();
  // The mint and revoke outcomes are announced only because their container is a live
  // region, and nothing else in the suite says so (issue #368). Asserted here, empty and
  // before any outcome exists, for the reason #307 gives: a region has to be present and
  // observed before its content arrives, so present-and-live is the state worth pinning.
  const linksStatus = page.getByTestId("qcms-links-status");
  await expect(linksStatus).toBeAttached();
  await expect(linksStatus).toBeEmpty();
  await expect(linksStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "secure links, none minted");

  await page.getByRole("button", { name: "Mint links" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoViolations(page, "mint dialog");

  await fillDate(page, "Expires", "12312030");
  await page.getByRole("dialog").getByRole("button", { name: "Mint", exact: true }).click();
  await expect(page.getByTestId("qcms-minted-links")).toBeVisible({ timeout: 30_000 });
  await expectNoViolations(page, "minted links, shown once");

  await page.getByTestId("qcms-minted-links").getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("qcms-links-table")).toBeVisible();
  await expectNoViolations(page, "secure links table");

  await page
    .getByTestId("qcms-links-table")
    .getByRole("button", { name: "Revoke" })
    .first()
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "revoke confirmation");

  // The revoked chip carries a different token pair from the active one, so it is a
  // different contrast question in all three modes - and until this state was swept,
  // Active was the only one of the four chip states the gate had ever measured.
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke it" }).click();
  await expect(page.getByTestId("qcms-links-table").getByText("Revoked")).toBeVisible({
    timeout: 30_000,
  });
  await expectNoViolations(page, "secure links table with a revoked link");
});

test("the operations screens have zero violations", async ({ page }) => {
  // Task 035, exit criterion 5, extended for issue #306. Nineteen states across seven
  // screens, and the reason each is here rather than covered by "the responses page"
  // as one:
  //
  //  - Six are **tables whose cells hold badges and buttons**, which is where a name
  //    is most easily lost, and whose badge tints are a different contrast question in
  //    each of the three modes (the same lesson 034's revoked chip taught). Three of
  //    the six are the delivery dashboard, once per `DeliveryStatusTag` tint, because
  //    a dashboard is only ever measured in the statuses it happens to be holding.
  //  - Four are **dialogs**: an export form, a type-to-confirm erasure with an error
  //    state, and two destructive confirmations.
  //  - One is the **one-time secret reveal**, which is an assertive live region.
  //  - One is a **disclosure inside a table row**, whose panel is a second `<tr>` and
  //    carries the consumer's response body in a scroll box.
  //  - One is the **tombstone**, the post-erasure state of a screen that showed answers
  //    a moment earlier.
  //
  // ## Why the delivery half runs real deliveries
  //
  // The three delivery tints and the flagged badge are not render-time variants a
  // fixture can choose: a row is dead-lettered because ten attempts failed, and it is
  // delivered because one succeeded. Before #306 this sweep configured an endpoint and
  // stopped, so `--color-success-subtle`, `--color-info-subtle` and
  // `--color-danger-subtle` were never measured in any mode and the disclosure panel
  // was never opened - which is precisely where the `.qcms-snippet` keyboard trap
  // (#309) had been sitting unseen, since `scrollable-region-focusable` can only fire
  // on a scroll box that is actually on screen.
  //
  // Sixty axe runs (issue #511 added the cold tombstone route, one state in three modes)
  // plus two forms' worth of submissions and a full retry budget, so the budget is
  // generous.
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const pub = pubForm;
  expect(pub, "the publish sweep above must have published its form first").not.toBeNull();
  if (pub === null) return;

  const consumer = new TestConsumer();
  // Rejecting, and verbosely: an HTML-error-page-shaped answer is exactly the case
  // `.qcms-snippet` exists to contain, and a 5xx keeps a status and a body on the row
  // where a refused connection would leave neither.
  consumer.status = 500;
  consumer.body = TALL_RESPONSE_BODY;
  await consumer.start();
  const deliverer = openDeliverer();
  try {
    await sweepOperations(page, pub, consumer, deliverer);
  } finally {
    await deliverer.close();
    await consumer.stop();
  }
});

/** The body of the operations sweep, so its fixtures can be closed in one `finally`. */
async function sweepOperations(
  page: Page,
  pub: NonNullable<typeof pubForm>,
  consumer: TestConsumer,
  deliverer: ReturnType<typeof openDeliverer>,
): Promise<void> {
  // A response to look at, made through the real respondent routes (see support/ops.ts).
  const sessionId = await submitResponse(OPS_SLUG, [
    ["q_at_fault_accident", true],
    ["q_accident_count", 4],
  ]);
  // And one the anti-abuse check flags, so the response browser below carries BOTH
  // `FlagTag` variants. The flagged tint is `--color-warning-subtle` and was
  // unreachable from this sweep until #306; a flagged submission also enqueues no
  // outbox event, so it adds nothing to the delivery half.
  await submitResponse(OPS_SLUG, [["q_at_fault_accident", false]], {
    honeypotField: deliverer.honeypotField,
  });

  await page.goto("/responses");
  await expect(page.getByTestId("qcms-responses-form-list")).toBeVisible();
  await expectNoViolations(page, "the responses area");

  await page.goto("/responses/erasures");
  await expect(page.getByRole("heading", { name: "Erasure log" })).toBeVisible();
  await expectNoViolations(page, "the erasure log");

  await page.goto(`/forms/${OPS_FORM_ID}/responses`);
  const responses = page.getByTestId("qcms-responses-table");
  await expect(responses).toBeVisible();
  // Asserted, not assumed: the sweep's claim is that it measures BOTH flag tints, and
  // an ordering change that pushed the flagged submission onto page two would quietly
  // reduce this back to the coverage #306 was filed about.
  await expect(responses.locator('[data-flagged="true"]').first()).toBeVisible();
  await expect(responses.locator('[data-flagged="false"]').first()).toBeVisible();
  await expectNoViolations(page, "the response browser");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByTestId("qcms-export-dialog")).toBeVisible();
  await expectNoViolations(page, "the export dialog");
  await page.keyboard.press("Escape");

  await page.goto(`/forms/${OPS_FORM_ID}/responses/${sessionId}`);
  await expect(page.getByTestId("qcms-response-detail")).toBeVisible();
  await expectNoViolations(page, "a response detail with its ledger");

  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  await expect(page.getByTestId("qcms-erase-dialog")).toBeVisible();
  await expectNoViolations(page, "the erasure confirmation");

  // The invalid state of the confirmation field: an error message wired to an input
  // inside an alertdialog is a name/description pair axe can actually check.
  await page
    .getByTestId("qcms-erase-dialog")
    .getByRole("textbox", { name: /Type the session id/ })
    .fill("wrong");
  await expectNoViolations(page, "the erasure confirmation, mismatched");

  await page
    .getByTestId("qcms-erase-dialog")
    .getByRole("textbox", { name: /Type the session id/ })
    .fill(sessionId);
  await page.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expectNoViolations(page, "the tombstone");

  // And the same URL opened cold, which is a **different render** of the same card and
  // was not swept until issue #511. In place, the tombstone arrives inside
  // `ResponseDetail`; from a link in a ticket, the route renders the card directly under
  // `FormPageHeader` with no component around it. The defect #511 was filed for lived
  // only in that second render, so a sweep that reached the first one and stopped was
  // blind to it by construction.
  await page.goto(`/forms/${OPS_FORM_ID}/responses/${sessionId}`);
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expectNoViolations(page, "the tombstone route, opened cold");

  await page.goto(`/forms/${pub.formId}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
  // Issue #307: the secret's live region is mounted from the first render and is
  // empty, rather than arriving already full. A region that appears already populated
  // is announced unreliably, and this is the state where the difference is visible.
  const secretRegion = page.getByTestId("qcms-webhook-secret-region");
  await expect(secretRegion, "the assertive region exists before any secret does").toBeAttached();
  await expect(secretRegion).toBeEmpty();
  // And it is still a live region (issue #359). Nothing above asserts that: an empty
  // div with the attribute deleted is attached, is empty, still nests the secret when
  // it arrives, and passes axe - which has no rule requiring a live region to exist and
  // can only judge the ones it finds. Any a11y property whose value comes from an
  // element merely being present needs saying out loud, or a tidy-up that removes an
  // "empty div" undoes #307 with a green run.
  await expect(secretRegion).toHaveAttribute("aria-live", "assertive");
  await expect(page.getByTestId("qcms-webhook-status")).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "webhook config with no endpoint");

  await page.getByRole("button", { name: "Add endpoint" }).click();
  const create = page.getByTestId("qcms-webhook-url-dialog");
  await expect(create).toBeVisible();
  await expectNoViolations(page, "the add-endpoint dialog");
  await create.getByRole("textbox", { name: "Endpoint URL" }).fill(consumer.url());
  await create.getByRole("button", { name: "Create endpoint" }).click();
  await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible({ timeout: 30_000 });
  // The same region, now filled: the announcement is a content change inside a region
  // that was already there, which is the shape every other live region in this app has.
  await expect(secretRegion.getByTestId("qcms-webhook-secret")).toBeVisible();
  await expectNoViolations(page, "the one-time secret reveal");

  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(page.getByTestId("qcms-webhooks-table")).toBeVisible();
  await expectNoViolations(page, "the endpoints table");

  await sweepDeliveries(page, pub, consumer, deliverer);
}

/**
 * The delivery states, swept in every mode (issue #306).
 *
 * Two submissions rather than one, so the queue can be worked both ways an operator
 * works it: one row redelivered on its own, and the rest taken in bulk. Both of those
 * are also the paths where focus used to be dropped on `<body>` when the button that
 * opened the confirmation went away with the row it belonged to (issue #308), so the
 * focus target is asserted here where the queue actually exists rather than in a
 * second setup of its own.
 *
 * It leaves the queue **empty**, and that is load-bearing rather than tidy:
 * `responses-ops.pw.ts` counts every row of the global dead-letter queue later in the
 * run, and a sweep that walked away from two stuck deliveries would be handing that
 * spec a number it has no way to explain.
 */
async function sweepDeliveries(
  page: Page,
  pub: NonNullable<typeof pubForm>,
  consumer: TestConsumer,
  deliverer: ReturnType<typeof openDeliverer>,
): Promise<void> {
  for (let count = 0; count < 2; count += 1) {
    await submitResponse(pub.slug, [
      [pub.choiceId, pub.choiceOption],
      [pub.countId, 3],
    ]);
  }

  // One pass: the events fan out to the endpoint and each attempt is refused with a
  // 500, which leaves the rows retryable. That is `pending`, `--color-info-subtle`.
  await deliverer.pass();
  await page.goto(`/forms/${pub.formId}/webhooks`);
  const deliveries = page.getByTestId("qcms-deliveries-table");
  await expect(deliveries.locator('[data-status="pending"]')).toHaveCount(2);
  await expectNoViolations(page, "the delivery dashboard with a rejected delivery");

  // The disclosure panel, open. Its `<pre>` holds the consumer's answer, which is tall
  // enough to scroll - so this is the state `scrollable-region-focusable` measures.
  await deliveries
    .getByRole("button", { name: /^Show request and response/ })
    .first()
    .click();
  const detail = page.getByTestId("qcms-delivery-detail");
  await expect(detail.getByTestId("qcms-delivery-response-code")).toHaveText("500");
  const snippet = detail.getByTestId("qcms-delivery-response-body");
  await expect(snippet).toContainText('"line_21"');
  expect(
    await snippet.evaluate((el) => el.scrollHeight > el.clientHeight),
    "the response body must actually overflow, or the keyboard-trap rule cannot fire",
  ).toBe(true);
  await expectNoViolations(page, "the delivery-detail disclosure");

  // Exhaust the retry budget: `deadLettered`, `--color-danger-subtle`.
  await deliverer.drive(11);
  await page.reload();
  await expect(deliveries.locator('[data-status="deadLettered"]')).toHaveCount(2);
  await expectNoViolations(page, "the delivery dashboard with a dead-lettered delivery");

  await page.goto("/webhooks");
  const queue = page.getByTestId("qcms-dead-letters-table");
  await expect(queue.locator("tr[data-delivery-id]")).toHaveCount(2);
  await expectNoViolations(page, "the dead-letter queue with a stuck delivery");
  // The redelivery summary below is announced only because this container is a live
  // region, and nothing else in the suite says so (issue #359). The shell's own region
  // is asserted here too: it is what carries an outcome whose screen is about to be
  // replaced (issue #355), and it is on every authenticated page including this one.
  await expect(page.getByTestId("qcms-dead-letters-status")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("qcms-announcer")).toHaveAttribute("aria-live", "polite");

  // Fix the consumer, then work the queue. Both actions remove the control that
  // started them, which is why the focus assertions belong here.
  consumer.status = 200;
  await queue
    .locator("tr[data-delivery-id]")
    .first()
    .getByRole("button", { name: /^Redeliver response\.submitted to / })
    .click();
  await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
    "1 delivery is queued for the next pass.",
  );
  // Issue #308: the row carried the button that was pressed, so restoring focus to it
  // is restoring focus to nothing. The queue's own heading is the successor - the
  // operator stays on the worklist they are working, with the summary they just earned
  // directly beneath it.
  await expect
    .poll(() => activeElementId(page), {
      message: "focus after redelivering one stuck delivery",
      timeout: 5_000,
    })
    .toBe("qcms-dead-letters-heading");
  await expect(queue.locator("tr[data-delivery-id]")).toHaveCount(1);

  await page.getByRole("button", { name: "Redeliver all" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "the redeliver-all confirmation");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Redeliver all of them" })
    .click();
  await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
    "1 delivery is queued for the next pass.",
  );
  await expect
    .poll(() => activeElementId(page), {
      message: "focus after redelivering the rest of the queue",
      timeout: 5_000,
    })
    .toBe("qcms-dead-letters-heading");

  // The pass that succeeds: `delivered`, `--color-success-subtle`.
  await deliverer.pass();
  await page.goto(`/forms/${pub.formId}/webhooks`);
  await expect(deliveries.locator('[data-status="delivered"]')).toHaveCount(2);
  await expectNoViolations(page, "the delivery dashboard with a delivered delivery");

  await page.goto("/webhooks");
  await expect(page.getByTestId("qcms-dead-letters-empty")).toBeVisible();
  await expectNoViolations(page, "the dead-letter queue");
}

test("the 2FA challenge and its recovery variant have zero violations", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await expectNoViolations(page, "2FA challenge");

  await page.goto("/two-factor/challenge?error=1");
  await expectNoViolations(page, "2FA challenge error");

  await page.getByRole("link", { name: "Use a recovery code instead" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery$/);
  await expectNoViolations(page, "2FA recovery entry");
});

test("the whole auth loop is reachable by keyboard alone", async ({ page }) => {
  // Not an axe check: axe cannot tell whether a control is *reachable*, which is the defect
  // class issue #144 shipped (a control rendered, labelled, and unfocusable).
  // Each half re-runs from its own `goto` if the document is replaced mid-typing. Under
  // `next dev` a route compiled on demand can reload the page after Playwright has typed
  // into it, leaving empty required fields; Enter then hits the browser's own constraint
  // validation and nothing navigates, which surfaced as this test parking on the screen it
  // had just filled in (issue #210). Retrying the block is the only robustness added -
  // every focus assertion, the typing, and Enter are exactly as they were, because
  // keyboard-only operation is the property under test and `fill()` would not prove it.
  await expect(async () => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // email
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.type(EMAIL);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.type(TEST_PASSWORD);
    await expect(page.getByLabel("Email")).toHaveValue(EMAIL, { timeout: 1000 });
    await expect(page.getByLabel("Password")).toHaveValue(TEST_PASSWORD, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await expect(async () => {
    const code = await generate({ secret: totpSecret });
    await page.goto("/two-factor/challenge");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // code field
    await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
    await page.keyboard.type(code);
    await expect(page.getByLabel(/Six-digit code/)).toHaveValue(code, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/questions$/);
});
