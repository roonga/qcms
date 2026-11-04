import { chooseEnvironment } from "./support/environment.js";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { generate } from "otplib";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  accountTrigger,
  activeElementId,
  enrollNewAdmin,
  fillStable,
  openAppearance,
  openMenu,
  readSetupKey,
  signInWithTotp,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  closeRuleEditor,
  moveStep,
  openFormDetails,
  openRuleEditor,
  openRulePhase,
  pinQuestion,
  rule,
  toggleCheckbox,
  savedStamp,
  toggleTarget,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { openDeliverer, submitResponse, TestConsumer } from "./support/ops.js";
import { chooseDestination, chooseSource, publishDraftThroughWizard } from "./support/publish.js";
import {
  addOption,
  chooseType,
  confirmLifecycle,
  createDraft,
  field,
  fillDate,
  grip,
  openPanel,
  optionIds,
  pendingRow,
} from "./support/questions.js";

// Each test needs its own browser context to retain the shared console gate.
// Root classes isolate palette measurement; appearance.pw.ts covers the controls and cookies.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("a11y");

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

const OPS_SLUG = "auto";
const OPS_FORM_ID = "frm_auto_quote";

// Use this sweep's own form: responses-ops.pw.ts asserts exact delivery counts on the seed.
// Serial declaration order hands the published form to the operations sweep; filtering tests breaks it.
let pubForm: {
  readonly formId: string;
  readonly slug: string;
  readonly choiceId: string;
  readonly choiceOption: string;
  readonly countId: string;
} | null = null;

// Axe checks scrollable-region-focusable only when content actually overflows.
// Keep the multiline body below RESPONSE_SNIPPET_MAX so storage preserves its height.
const TALL_RESPONSE_BODY = `{\n${Array.from(
  { length: 22 },
  (_, index) => `  "line_${String(index)}": "x"`,
).join(",\n")}\n}`;

// The diff must overflow for axe to check scrollable-region-focusable.
// Use a long title to produce a long canonical-JSON line without changing the rest of the fixture.
const OVERFLOWING_FORM_TITLE =
  "Publish sweep form with a deliberately long title, so the canonical JSON " +
  "definition prints a line no version column can contain without scrolling";

// Select trigger names combine label and value, with the label first.
// The shared chooseOption fallback anchors the label at the end and cannot match these controls.
async function chooseVersion(page: Page, label: string, version: string): Promise<void> {
  const trigger = page.getByRole("button", { name: new RegExp(label) });
  await trigger.click();
  await page.getByRole("option", { name: version, exact: true }).click();
  await expect(trigger).toContainText(version);
}

// The backlog must exceed one deliverer pass so the round helper has to drain multiple batches.
const BACKLOG_EVENTS = 25;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// heading-order has no WCAG tag; label-content-name-mismatch is excluded by its experimental tag.
// Explicit rule enables bypass those filters. Keep runOnly and rules in one options call:
// AxeBuilder.options replaces accumulated options, including tags set by withTags.
const EXTRA_RULES = {
  "heading-order": { enabled: true },
  "label-content-name-mismatch": { enabled: true },
};

// Exceptions are scoped to state and node so unrelated heading gaps still fail.
// The converse assertion rejects stale entries that could otherwise hide a later regression.
const KNOWN_HEADING_ORDER_GAPS: Readonly<Record<string, readonly string[]>> = {};

const MODES = [
  { name: "light", rootClasses: [] as readonly string[] },
  { name: "dark", rootClasses: ["dark"] },
  { name: "high-contrast", rootClasses: ["hc"] },
  { name: "high-contrast, dark field", rootClasses: ["dark", "hc"] },
] as const;

async function expectNoViolations(page: Page, state: string): Promise<void> {
  // Wait for hydration before evaluate: a dev-server reload destroys its execution context.
  await waitForHydration(page);
  const original = await page.evaluate(() => document.documentElement.className);
  const originalScroll = await page.evaluate(() => window.scrollY);
  try {
    for (const mode of MODES) {
      await page.evaluate(
        (rootClasses) => {
          for (const candidate of ["light", "dark", "hc"]) {
            document.documentElement.classList.remove(candidate);
          }
          for (const candidate of rootClasses) document.documentElement.classList.add(candidate);
        },
        mode.rootClasses as readonly string[],
      );
      await settleTransitions(page);
      // Sticky navigation can transiently overlap scrolled controls during axe target-size hit-testing.
      // Measure at the top to exclude reading-position overlap while retaining permanently covered targets.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      const results = await new AxeBuilder({ page })
        .options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })
        .analyze();

      expect(
        rulesNotRun(results, Object.keys(EXTRA_RULES)),
        `axe did not load these rules on the ${state} state in ${mode.name}: the tag selection alone drops them, so EXTRA_RULES is what puts them in the run and it is not reaching axe`,
      ).toEqual([]);

      const allowed = KNOWN_HEADING_ORDER_GAPS[state] ?? [];
      const violations = results.violations.filter(
        (v) =>
          v.id !== "heading-order" ||
          v.nodes.some((node) => !allowed.includes(node.target.join(" "))),
      );

      expect(
        violations.map(
          (v) =>
            `${v.id}: ${v.help} [${v.nodes
              .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
              .join(" | ")}]`,
        ),
        `axe violations on the ${state} state in ${mode.name}`,
      ).toEqual([]);

      // A stale exception would silently excuse a future regression on the same node.
      const violatingNodes = new Set(
        results.violations
          .filter((v) => v.id === "heading-order")
          .flatMap((v) => v.nodes.map((node) => node.target.join(" "))),
      );
      expect(
        allowed.filter((target) => !violatingNodes.has(target)),
        `stale KNOWN_HEADING_ORDER_GAPS entries for the ${state} state in ${mode.name}: these nodes no longer raise heading-order, so delete them from the register rather than leaving a mute armed`,
      ).toEqual([]);
    }
  } finally {
    await page.evaluate(
      ({ className, scrollY }) => {
        document.documentElement.className = className;
        window.scrollTo(0, scrollY);
      },
      { className: original, scrollY: originalScroll },
    );
  }
}

test("the signed-out and failure states have zero violations", async ({ page }) => {
  await page.goto("/sign-in");
  await expectNoViolations(page, "signed-out");

  // Next adds a route-announcer alert outside main during hydration; scope to the page's own alert.
  await page.goto("/sign-in?error=1");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expectNoViolations(page, "sign-in error");

  await page.goto("/sign-in?throttled=1");
  await expectNoViolations(page, "sign-in throttled");

  await page.goto("/sign-in?expired=1");
  await expectNoViolations(page, "session expired");
});

test("the forced password-change screen has zero violations", async ({ page }) => {
  // Changing the provisional password clears its flag, so use an account separate from the shared auth fixture.
  const provisional = uniqueAdminEmail("a11ypw");
  await createTestAdmin(provisional, { mustChangePassword: true });
  await submitSignIn(page, provisional);
  await expect(page).toHaveURL(/\/change-password$/);
  await expectNoViolations(page, "forced password change");

  await page.goto("/change-password?mismatch=1");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expectNoViolations(page, "forced password change, mismatch");
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
  test.setTimeout(500_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  for (const path of [
    "/questions",
    "/questions/new",
    "/forms",
    "/forms/new",

    "/me/access",
    "/operations",
    "/responses",
    "/responses/erasures",
    "/webhooks",
    "/workspaces",
    "/settings",
  ]) {
    await page.goto(path);
    await expectNoViolations(page, `shell ${path}`);
  }
});

test("both topbar menus have zero violations while OPEN, in every mode", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await openAppearance(page);
  await expectNoViolations(page, "appearance panel open");

  // React Aria switches and radios use visually hidden inputs; the label is the pointer target.
  await page
    .getByRole("switch", { name: /High contrast/u })
    .locator("xpath=ancestor::label[1]")
    .click();
  await page
    .getByRole("radio", { name: "Dark", exact: true })
    .locator("xpath=ancestor::label[1]")
    .click();
  await expectNoViolations(page, "appearance panel open, dark field at high contrast");
  await page.keyboard.press("Escape");

  await openMenu(accountTrigger(page));
  await expectNoViolations(page, "account menu open");
  await page.keyboard.press("Escape");
});

// Keep the unique suffix decimal: base-36 timestamps could contain the account's initials.
// The address must lack both initials so axe cannot pass label-in-name on the address alone.
const MISMATCH_NAME = "Zoe Wren";
const MISMATCH_INITIALS = "ZW";
const MISMATCH_EMAIL = `e2e.labelinname.${Date.now().toString(10)}@admin.test`;

test("the account trigger passes label-in-name for an account whose address cannot supply its initials", async ({
  page,
}) => {
  for (const letter of MISMATCH_INITIALS.toLowerCase()) {
    expect(
      MISMATCH_EMAIL.toLowerCase(),
      `the address must not contain "${letter}", or label-content-name-mismatch can pass without the monogram being in the name`,
    ).not.toContain(letter);
  }

  await createTestAdmin(MISMATCH_EMAIL, { name: MISMATCH_NAME });
  await enrollNewAdmin(page, MISMATCH_EMAIL);

  const trigger = accountTrigger(page);
  await expect(trigger).toHaveText(MISMATCH_INITIALS);
  await expect(trigger).toHaveAccessibleName(
    `${MISMATCH_INITIALS}, account menu for ${MISMATCH_EMAIL}`,
  );

  // Explicitly enable the experimental rule; runOnly alone still excludes its tag.
  const results = await new AxeBuilder({ page })
    .include(".qcms-topbar")
    .options({
      runOnly: { type: "rule", values: ["label-content-name-mismatch"] },
      rules: { "label-content-name-mismatch": { enabled: true } },
    })
    .analyze();

  expect(
    rulesNotRun(results, ["label-content-name-mismatch"]),
    "the rule this test is entirely about did not join the run, so its verdict says nothing",
  ).toEqual([]);
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
    ),
    "label-content-name-mismatch on the topbar, for an account whose address cannot mask it",
  ).toEqual([]);
});

test("the question library, its editor and a question's detail have zero violations", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions");
  await expectNoViolations(page, "question library list");

  await page.goto("/questions/new");
  await expectNoViolations(page, "question editor, empty");

  await chooseType(page, "Single choice");
  const slug = `a11y-question-${Date.now().toString(36)}`;
  await fillStable(field(page, "Slug"), slug);
  await fillStable(field(page, "Label"), "Which cover applies?");
  await addOption(page, "Comprehensive");
  await addOption(page, "Third party");
  await expectNoViolations(page, "question editor, option list");

  // Focusing a label reveals the grip and insert controls; their contrast cannot be measured at rest.
  await field(page, "Option 1 label").focus();
  await expectNoViolations(page, "question editor, option grid with a cell editing");

  await grip(page, 0).focus();
  await grip(page, 0).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expectNoViolations(page, "question editor, option row menu open");
  await page.getByRole("menu").press("Escape");

  await page.getByRole("button", { name: "Add option" }).click();
  await expect(pendingRow(page)).toBeFocused();
  await expectNoViolations(page, "question editor, ghost row opened and unnamed");
  await pendingRow(page).blur();

  await Promise.all([
    page.waitForURL(/\/questions\/q_/),
    page.getByRole("button", { name: "Create draft" }).click(),
  ]);
  await expectNoViolations(page, "question detail, editor panel");

  await openPanel(page, "preview");
  await expectNoViolations(page, "question detail, preview panel");
  await openPanel(page, "content");

  await page.getByRole("button", { name: /^Publish version 1$/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "publish confirmation");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: /^Publish version 1$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await expectNoViolations(page, "frozen published version");
});

test("the message and boolean-label fields have zero violations (048)", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions/new");
  await chooseType(page, "Short text");
  await fillStable(field(page, "Slug"), `a11y-messages-${Date.now().toString(36)}`);
  await fillStable(field(page, "Label"), "What is your policy number?");

  await page.getByText("An answer is required", { exact: true }).click();
  await fillStable(field(page, "Shortest answer"), "8");
  await fillStable(field(page, "Longest answer"), "12");
  await fillStable(field(page, "Pattern"), "^[A-Z]{2}[0-9]{6}$");

  const patternVerdict = page.getByTestId("qcms-pattern-verdict");
  await expect(patternVerdict).toBeAttached();
  await expect(patternVerdict).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "question editor, message fields on their placeholders");

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

  await page.goto("/forms/new");
  await expectNoViolations(page, "new form");

  await createForm(page, `a11y-form-${run}`, "Accessibility sweep form");

  await expectNoViolations(page, "form builder, empty");

  await addStep(page, "Cover");

  await page.getByRole("button", { name: "Add question from library" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoViolations(page, "library picker dialog");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await pinQuestion(page, choiceId, 1);
  await addStep(page, "Details");
  await pinQuestion(page, textId, 1);
  await waitForSaved(page);

  await expectNoViolations(page, "form builder with steps and pins");

  await openFormDetails(page);

  const validationStatus = page.getByTestId("qcms-validation-status");
  await expect(validationStatus).toBeAttached();
  await expect(validationStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "form builder showing the form's own details");

  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", choiceOption);
  await expectNoViolations(page, "rule wizard, the When phase");

  await toggleTarget(page, ruleId, textId, true);
  await expectNoViolations(page, "rule wizard, the Then show phase");

  await page.getByRole("button", { name: "Why these cannot be shown" }).click();
  await expectNoViolations(page, "rule wizard, the target ordering help open");

  await closeRuleEditor(page);

  await expectNoViolations(page, "the rules screen");

  await openFormDetails(page);
  const beforeMoveUp = await savedStamp(page);
  await moveStep(page, "Details", "up");
  // Wait for the debounced edit before crossing routes: the editor reads the server's stored draft.
  await waitForSaveAfter(page, beforeMoveUp);
  await openRuleEditor(page, ruleId);
  await openRulePhase(page, "then");
  await expect(page.getByTestId("qcms-backward-flag")).toBeVisible();
  await expectNoViolations(page, "rule wizard with a backward target flagged");

  await openRulePhase(page, "test");
  // Both benches share child testids; scope to the wizard's bench rather than the screen's bench.
  const benchStatus = page.getByTestId("qcms-bench").getByTestId("qcms-bench-status");
  await expect(benchStatus).toBeAttached();
  await expect(benchStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "rule wizard, the Test phase");

  await closeRuleEditor(page);

  const beforeLeaving = await savedStamp(page);
  await openRuleEditor(page, ruleId);
  await expect(scope.locator('[data-issue-code="RULE_BACKWARD_TARGET"]')).toBeVisible({
    timeout: 30_000,
  });
  await expectNoViolations(page, "rule wizard showing the engine's verdict on the rule");
  // Restore step order: removing the rule's only target would leave a different publish refusal.
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeLeaving);
  await openFormDetails(page);
  const beforeMoveDown = await savedStamp(page);
  await moveStep(page, "Details", "down");
  await waitForSaveAfter(page, beforeMoveDown);

  await openFormDetails(page);

  await toggleCheckbox(page, "Require a challenge before answering", true);
  const settingsStatus = page.getByTestId("qcms-form-settings-status");
  await expect(settingsStatus).toBeAttached();
  await expect(settingsStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "form settings on the form's own screen");
});

test("publish, preview, history and secure links have zero violations", async ({
  page,
  context,
}) => {
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
  // Capture the save baseline before opening the buffered editor; its Save makes one mutation.
  const beforeRule = await savedStamp(page);
  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", choiceOption);
  await toggleTarget(page, ruleId, countId, true);
  // Close the modal before reading the save strip behind its overlay.
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeRule);

  await page.goto(`/forms/${formId}`);

  await publishDraftThroughWizard(page, { formId, version: 1, environment: "test" });

  const publishStatus = page.getByTestId("qcms-publish-result-status");
  await expect(publishStatus).toBeAttached();
  await expect(publishStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "publish success");

  await page.goto(`/forms/${formId}`);
  await openFormDetails(page);
  const beforeTitle = await savedStamp(page);
  await fillStable(field(page, "Form title"), OVERFLOWING_FORM_TITLE);
  await waitForSaveAfter(page, beforeTitle);
  await page.reload();
  await publishDraftThroughWizard(page, { formId, version: 2, environment: "test" });

  // Release the published form before the operations sweep starts respondent sessions.
  pubForm = { formId, slug, choiceId, choiceOption, countId };

  await page.goto(`/forms/${formId}/versions`);
  await chooseEnvironment(page, "prod");
  await expect(page.getByTestId("qcms-released-now")).toBeVisible();
  await expectNoViolations(page, "the Versions view, nothing released in prod yet");

  await page.goto(`/forms/${formId}/publish`);
  await expect(page.getByTestId("qcms-publish-source")).toBeVisible();
  await expectNoViolations(page, "the publish wizard, choosing a source");
  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();

  await expect(destinations.locator("legend")).toBeFocused();
  await expectNoViolations(page, "the publish wizard, choosing destinations");
  await chooseDestination(destinations, "prod");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const wizardReview = page.getByTestId("qcms-publish-review");
  await expect(wizardReview).toBeVisible();
  await expect(wizardReview.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(destinations.locator("legend")).toBeFocused();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(wizardReview).toBeVisible();
  await expectNoViolations(page, "the publish wizard, reviewing one destination");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-result")).toBeVisible({ timeout: 30_000 });
  await expectNoViolations(page, "the recorded publish outcome");

  await page.goto(`/forms/${formId}/versions`);
  await expect(page.getByTestId("qcms-release-history")).toBeVisible();
  await expectNoViolations(page, "the Versions view with a release history");

  await chooseEnvironment(page, "test");
  await page.goto(`/forms/${formId}/preview`);
  await expect(
    page.getByTestId("qcms-draft-preview").getByText("E2E Single choice question"),
  ).toBeVisible({
    timeout: 60_000,
  });

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
  await expect(page.getByRole("table", { name: "Published versions" })).toBeVisible();
  await expectNoViolations(page, "version history");

  // Assert real overflow before axe: a shorter fixture or wider column would otherwise disable the check silently.
  await chooseVersion(page, "Older version", "v1");
  await chooseVersion(page, "Newer version", "v2");
  const diffRegion = page.locator(".qcms-diff");
  await expect(page.getByTestId("qcms-version-diff")).toBeVisible();
  const overflows = await diffRegion.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(
    overflows,
    "the fixture diff must overflow horizontally, or scrollable-region-focusable has nothing to fire on and this sweep proves nothing (issue #354)",
  ).toBe(true);
  await expectNoViolations(page, "version diff, overflowing");

  await page.getByRole("link", { name: "View v1" }).click();
  await expect(page.getByTestId("qcms-version-view")).toBeVisible({ timeout: 60_000 });
  await expectNoViolations(page, "one published version, rendered from storage");

  await page.goto(`/operations/forms/${formId}/links`);
  await chooseEnvironment(page, "prod");
  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();
  // A live region must exist before its content changes for reliable announcements.
  const linksStatus = page.getByTestId("qcms-links-status");
  await expect(linksStatus).toBeAttached();
  await expect(linksStatus).toBeEmpty();
  await expect(linksStatus).toHaveAttribute("aria-live", "polite");
  await expectNoViolations(page, "secure links, none minted");

  await page.getByRole("button", { name: "Mint links" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoViolations(page, "mint dialog");

  await fillDate(page, "Expires", "12312030");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mint for prod", exact: true })
    .click();
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

  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke it" }).click();
  await expect(page.getByTestId("qcms-links-table").getByText("Revoked")).toBeVisible({
    timeout: 30_000,
  });
  await expectNoViolations(page, "secure links table with a revoked link");
});

test("the operations screens have zero violations", async ({ page }) => {
  test.setTimeout(1_200_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const pub = pubForm;
  expect(pub, "the publish sweep above must have published its form first").not.toBeNull();
  if (pub === null) return;

  const consumer = new TestConsumer();

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

async function sweepOperations(
  page: Page,
  pub: NonNullable<typeof pubForm>,
  consumer: TestConsumer,
  deliverer: ReturnType<typeof openDeliverer>,
): Promise<void> {
  const sessionId = await submitResponse(OPS_SLUG, [
    ["q_at_fault_accident", true],
    ["q_accident_count", 4],
  ]);

  await submitResponse(OPS_SLUG, [["q_at_fault_accident", false]], {
    honeypotField: deliverer.honeypotField,
  });

  await page.goto("/operations");
  await expect(page.getByTestId("qcms-operations-table")).toBeVisible();
  await expectNoViolations(page, "the Operations forms table");

  await page.goto(`/operations/forms/${pub.formId}/intake`);
  await waitForHydration(page);
  await expect(page.getByTestId("qcms-form-intake")).toBeVisible();
  await expectNoViolations(page, "one form's intake");
  await page.getByRole("button", { name: /^Close in / }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "close-form confirmation");
  await page.keyboard.press("Escape");

  await page.goto("/responses/erasures");
  await expect(page.getByRole("heading", { name: "Erasure log" })).toBeVisible();
  await expectNoViolations(page, "the erasure log");

  await page.goto(`/operations/forms/${OPS_FORM_ID}/responses`);
  const responses = page.getByTestId("qcms-responses-table");
  await expect(responses).toBeVisible();

  await expect(responses.locator('[data-flagged="true"]').first()).toBeVisible();
  await expect(responses.locator('[data-flagged="false"]').first()).toBeVisible();
  await expectNoViolations(page, "the response browser");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByTestId("qcms-export-dialog")).toBeVisible();
  await expectNoViolations(page, "the export dialog");
  await page.keyboard.press("Escape");

  await page.goto(`/operations/forms/${OPS_FORM_ID}/responses/${sessionId}`);
  await expect(page.getByTestId("qcms-response-detail")).toBeVisible();
  await expectNoViolations(page, "a response detail with its ledger");

  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  await expect(page.getByTestId("qcms-erase-dialog")).toBeVisible();
  await expectNoViolations(page, "the erasure confirmation");

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

  await page.goto(`/operations/forms/${OPS_FORM_ID}/responses/${sessionId}`);
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expectNoViolations(page, "the tombstone route, opened cold");

  await page.goto(`/operations/forms/${pub.formId}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
  // The secret region must be mounted empty before the one-time reveal to announce it reliably.
  const secretRegion = page.getByTestId("qcms-webhook-secret-region");
  await expect(secretRegion, "the assertive region exists before any secret does").toBeAttached();
  await expect(secretRegion).toBeEmpty();

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

  await expect(secretRegion.getByTestId("qcms-webhook-secret")).toBeVisible();
  await expectNoViolations(page, "the one-time secret reveal");

  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(page.getByTestId("qcms-webhooks-table")).toBeVisible();
  await expectNoViolations(page, "the endpoints table");

  await sweepDeliveries(page, pub, consumer, deliverer);
}

// Drain the global dead-letter queue before leaving: responses-ops.pw.ts counts its rows.
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

  await deliverer.plantBacklog(BACKLOG_EVENTS);

  // A round must reach the newest events behind the backlog; one pass cannot guarantee that.
  const passes = await deliverer.sweep();
  expect(
    passes,
    "the planted backlog must outlast one claim batch, or this proves nothing",
  ).toBeGreaterThan(1);
  await page.goto(`/operations/forms/${pub.formId}/webhooks`);
  const deliveries = page.getByTestId("qcms-deliveries-table");
  await expect(deliveries.locator('[data-status="pending"]')).toHaveCount(2);
  await expectNoViolations(page, "the delivery dashboard with a rejected delivery");

  // Resolve the opened row's aria-controls rather than assuming only one detail panel exists.
  const openedRow = deliveries.locator("tbody tr[data-delivery-id]").first();
  await openedRow.getByRole("button", { name: /^Show request and response/ }).click();
  const panelId =
    (await openedRow
      .getByRole("button", { name: /^Hide request and response/ })
      .getAttribute("aria-controls")) ?? "";
  expect(panelId, "the open row names its panel").toMatch(/^qcms-delivery-detail-/);
  const detail = page.locator(`#${panelId}`);
  await expect(detail.getByTestId("qcms-delivery-response-code")).toHaveText("500");
  const snippet = detail.getByTestId("qcms-delivery-response-body");
  await expect(snippet).toContainText('"line_21"');
  expect(
    await snippet.evaluate((el) => el.scrollHeight > el.clientHeight),
    "the response body must actually overflow, or the keyboard-trap rule cannot fire",
  ).toBe(true);
  await expectNoViolations(page, "the delivery-detail disclosure");

  await deliverer.drive(11);
  await page.reload();
  await expect(deliveries.locator('[data-status="deadLettered"]')).toHaveCount(2);
  await expectNoViolations(page, "the delivery dashboard with a dead-lettered delivery");

  await page.goto("/webhooks");
  const queue = page.getByTestId("qcms-dead-letters-table");
  await expect(queue.locator("tr[data-delivery-id]")).toHaveCount(2);
  await expectNoViolations(page, "the dead-letter queue with a stuck delivery");

  await expect(page.getByTestId("qcms-dead-letters-status")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("qcms-announcer")).toHaveAttribute("aria-live", "polite");

  consumer.status = 200;
  await queue
    .locator("tr[data-delivery-id]")
    .first()
    .getByRole("button", { name: /^Redeliver response\.submitted to / })
    .click();
  await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
    "1 delivery is queued for the next pass.",
  );

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

  await deliverer.pass();
  await page.goto(`/operations/forms/${pub.formId}/webhooks`);
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
  // Keep keyboard typing and Enter: fill would not prove keyboard reachability.
  // Hydration waits protect controlled inputs; toPass also covers dev-server document replacement.
  await expect(async () => {
    await page.goto("/sign-in");
    await waitForHydration(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
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
    await waitForHydration(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
    await page.keyboard.type(code);
    await expect(page.getByLabel(/Six-digit code/)).toHaveValue(code, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/questions$/);
});
