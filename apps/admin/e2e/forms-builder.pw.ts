import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  field,
  issue,
  issueSummary,
  movePin,
  openFormDetails,
  openRules,
  openStep,
  pinLabel,
  pinQuestion,
  rule,
  ruleIds,
  saveState,
  toggleCheckbox,
  toggleTarget,
  waitForSaved,
} from "./support/forms.js";
import {
  addOption,
  confirmLifecycle,
  createDraft,
  optionIds,
  useRowMenu,
} from "./support/questions.js";

/**
 * The form builder, driven through the browser (task 033, exit criteria 1, 2 and 3).
 *
 * ## Why the whole insurance form is built through the UI
 *
 * The thing under examination is the assembly, not any one component: a client holding a
 * working draft, pure helpers mutating it, a server action forwarding it, the kernel
 * judging it in the API, and path-addressed issues landing back on the rule or the pin
 * that caused them. Every seam in that chain is invisible to a unit test and every one of
 * them is where 033 could break. So the form is built the way an author builds one - three
 * questions authored and published first, then a form, steps, pins and a rule - and the
 * assertions are on what the author sees.
 *
 * ## The three findings each have their own test, and each is a different mechanism
 *
 * - **Exit 1** is the build: the form saves, and the validation panel reports a draft that
 *   would publish cleanly.
 * - **Exit 2** is the backward target, and it is deliberately asserted twice. The instant
 *   flag comes from `eligibleTargets`, which is pure draft geometry with no round trip, so
 *   it is asserted *before* the debounce can have landed. The `RULE_BACKWARD_TARGET` issue
 *   comes from the kernel's own `analyzeRuleGraph`, inside the validate call, and is
 *   asserted at the rule afterwards. Two mechanisms, two assertions: a test that only
 *   checked the second would pass with the instant feedback deleted.
 * - **Exit 3** is the pin move. The rule compares against an option id that exists in v1
 *   and not in v2, so moving the pin has to make a previously clean draft dirty. That is
 *   the whole R7 argument in one interaction: nothing auto-upgrades, and when an author
 *   moves a pin themselves the consequence surfaces immediately rather than at publish.
 *
 * `fillStable` throughout, for the reason issue #210 records.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("forms");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/**
 * A per-run suffix. Ids are never reused (R6) and the harness database can be reused
 * across local runs, so a fixed slug would fail the second run on a screen that works.
 */
const RUN = Date.now().toString(36);

/** The questions the insurance form pins, and the ids they were minted as. */
const AT_FAULT = `e2e-at-fault-accident-${RUN}`;
const ACCIDENT_COUNT = `e2e-accident-count-${RUN}`;
const CLAIM_NOTES = `e2e-claim-notes-${RUN}`;
const COVER_LEVEL = `e2e-cover-level-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/** The option id the at-fault question's first option was minted as. Read, never guessed. */
let atFaultYesOption = "";
/** The option id v1 of the cover-level question carries, which v2 will not. */
let coverV1Option = "";
/** The insurance form, built by the first test and edited by the second. */
let insuranceFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Author one question and publish v1, leaving the browser on its detail screen. */
async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

test("builds the insurance form through the UI and saves it (exit criterion 1)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // A form can only pin PUBLISHED versions (022), so the library is authored first. The
  // three shapes are the ones the rule needs: a choice question to branch on, a number to
  // reveal, and a long text in a later step to target across a step boundary.
  await publishQuestion(page, AT_FAULT, "Single choice");
  const options = await optionIds(page);
  atFaultYesOption = options[0] ?? "";
  expect(atFaultYesOption, "the choice question should carry minted option ids").toMatch(/^opt_/u);

  await publishQuestion(page, ACCIDENT_COUNT, "Number");
  await publishQuestion(page, CLAIM_NOTES, "Long text");

  insuranceFormId = await createForm(page, `e2e-vehicle-insurance-${RUN}`, "Vehicle insurance");

  await addStep(page, "Driving history");
  await pinQuestion(page, questionIdFor(AT_FAULT), 1);
  await pinQuestion(page, questionIdFor(ACCIDENT_COUNT), 1);

  await addStep(page, "Claim details");
  await pinQuestion(page, questionIdFor(CLAIM_NOTES), 1);

  // Rules belong to the FORM, so reaching them means leaving the step screen pinning left
  // us on. The builder has been three screens behind one route since 2026-08-26, and the
  // rules are one of them.
  await openRules(page);

  // The section that lists rules is headed "Rules", which is the word its own button, its
  // entities and the bench beside it already use (issue 661). It used to read
  // "Conditions", so an author read one name in the heading and another in everything
  // under it. The condition inside a rule keeps the word "condition": that is the `when`
  // half of a rule, not another name for the whole thing.
  await expect(page.getByRole("heading", { level: 2, name: "Rules", exact: true })).toBeVisible();

  // The at-fault-accident rule: when the driver says yes, ask for the notes in the next
  // step. A new rule starts as `answered` against the first pinned question, which is
  // already the one this rule reads.
  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", atFaultYesOption);
  await toggleTarget(page, ruleId, questionIdFor(CLAIM_NOTES), true);

  await waitForSaved(page);
  // The verdict is the FORM's and the rule is not, so the panel is read on the form's own
  // screen. Three screens, three homes: this is the one that counts issues.
  await openFormDetails(page);
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.");

  // The draft is on the server, not just on screen: a reload rebuilds it from the API. Each
  // of the three screens is asked for its own half of it.
  await page.reload();
  await expect(page.getByRole("button", { name: "Open step Driving history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open step Claim details" })).toBeVisible();
  await openRules(page);
  await expect(page.locator("[data-rule-id]")).toHaveCount(1);
  await openStep(page, "Driving history");
  await expect(pinLabel(page, questionIdFor(AT_FAULT), 1)).toBeVisible();
});

test("a backward target is flagged instantly and refused by the engine (exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  expect(ruleId, "the saved draft should still carry its rule").toMatch(/^rul_/u);
  const scope = rule(page, ruleId);

  // The rule's condition reads the at-fault question, so the at-fault question itself is
  // strictly before it in document order and cannot be a target (ADR-16). The picker lists
  // it under its own heading rather than hiding it, so the attempt is reachable.
  await expect(scope.getByText("Comes before this condition")).toBeVisible();
  await toggleTarget(page, ruleId, questionIdFor(AT_FAULT), true);

  // Instant, and asserted with a short timeout on purpose: this comes from draft geometry
  // in the browser, so it cannot be the debounced round trip arriving early.
  await expect(page.getByTestId("qcms-backward-flag")).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("qcms-backward-flag")).toContainText(questionIdFor(AT_FAULT));

  // And the engine's own finding, from `analyzeRuleGraph` inside the validate call, lands
  // on this rule rather than in a general list.
  await expect(issue(scope, "RULE_BACKWARD_TARGET")).toBeVisible({ timeout: 30_000 });
  // The finding is on the rule, on the rules screen; the COUNT is the form's, on the form's.
  await openFormDetails(page);
  await expect(issueSummary(page)).toContainText("would block a publish");

  // Untick it and the form is publishable again: the flag is a statement about the draft,
  // not a latch.
  await openRules(page);
  await toggleTarget(page, ruleId, questionIdFor(AT_FAULT), false);
  await expect(page.getByTestId("qcms-backward-flag")).toHaveCount(0);
  await openFormDetails(page);
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.", {
    timeout: 30_000,
  });
});

test("moving a pin re-runs validation and surfaces the broken option ref (exit criterion 3)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // v1 carries the options `createDraft` names; v2 replaces both, so an option id that is
  // legal against v1 is dangling against v2. That is the state exit criterion 3 is about,
  // and it is reached the way an author reaches it: by publishing a second version.
  await publishQuestion(page, COVER_LEVEL, "Single choice");
  const v1Options = await optionIds(page);
  coverV1Option = v1Options[0] ?? "";
  expect(coverV1Option).toMatch(/^opt_/u);

  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  // Added before the originals are removed, and that order is the editor's rule rather than
  // a preference: the kernel requires a choice question to declare at least one option, so
  // the editor disables removing the last one. Emptying the list first is not a state a
  // choice question is allowed to pass through.
  await addOption(page, "Full cover");
  await addOption(page, "Basic cover");
  // Remove lives in the row's own menu under the 057 grid, not in a trailing button.
  await useRowMenu(page, 0, /^Remove option /);
  await useRowMenu(page, 0, /^Remove option /);
  await expect(page.getByRole("textbox", { name: /^Option \d+ label$/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  const v2Options = await optionIds(page);
  expect(v2Options, "v2 should carry different option ids than v1").not.toContain(coverV1Option);
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  // A second form, so the first one's assertions stay about the first one.
  await createForm(page, `e2e-cover-choice-${RUN}`, "Cover choice");
  await addStep(page, "Cover");
  await pinQuestion(page, questionIdFor(COVER_LEVEL), 1);
  await addStep(page, "Details");
  await pinQuestion(page, questionIdFor(CLAIM_NOTES), 1);

  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", coverV1Option);
  await toggleTarget(page, ruleId, questionIdFor(CLAIM_NOTES), true);
  await waitForSaved(page);
  await openFormDetails(page);
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.");

  // The move itself: one pin, one version, chosen from the menu that lists published
  // versions only (R7). Nothing else in the draft changes.
  await openStep(page, "Cover");
  await movePin(page, questionIdFor(COVER_LEVEL), 2);

  // The version change is on screen, validation re-ran on its own, and the consequence is
  // reported at the rule that carries the now-dangling option id.
  await expect(pinLabel(page, questionIdFor(COVER_LEVEL), 2)).toBeVisible();
  // Three screens, three readings of one consequence: the pin is the step's, the finding is
  // on the rule and therefore on the rules screen, and the count is the form's.
  await openRules(page);
  await expect(issue(scope, "DANGLING_OPTION_REF")).toBeVisible({ timeout: 30_000 });
  await openFormDetails(page);
  await expect(issueSummary(page)).toContainText("would block a publish");
});

test("the settings panel says a required challenge is unenforceable, and stores it unpressed", async ({
  page,
}) => {
  // Two claims in one visit, because the second is what the first now depends on.
  //
  // Task file line 26: a challenge is a deployment capability, and the harness configures
  // no provider, so the switch enforces nothing until an operator sets one up. A panel
  // that stayed silent would let an author believe a form was protected.
  //
  // And since 2026-08-29 (`plan/admin-design-contracts.md` §6) there is no "Save settings"
  // to press. The switch reaches the API on the builder's own debounce, which makes the
  // reload below the assertion that matters: nothing on this screen was pressed, and the
  // setting is still there.
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await toggleCheckbox(page, "Require a challenge before answering", true);
  await expect(page.getByTestId("qcms-challenge-unenforceable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
    "the settings panel has no save control of its own any more",
  ).toHaveCount(0);

  // The screen's ONE save statement reports it. The strip opens on "Not saved yet" every
  // visit, so a timestamp here can only have come from the settings write - the draft has
  // not been touched.
  await expect(saveState(page)).toContainText(/^Last saved /, { timeout: 30_000 });

  // It survives a reload, which is what makes it a setting rather than a checkbox.
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Require a challenge before answering" }),
  ).toBeChecked();
});

test("a settings write the API refuses is said, with no press to have reported it", async ({
  page,
}) => {
  // The failure an explicit Save button used to make obvious. Autosave has no press to
  // report back to, so a refused write would otherwise leave an author believing a
  // deployment switch is set when it is not - which is the whole risk the 2026-08-29
  // amendment to §6 had to answer for before the button could go.
  //
  // The refusal is the real route's: `UpdateFormSettingsBody` caps the override at one
  // hour, and the field offers no upper bound, so a larger number is a 400 from the API
  // rather than anything mocked here.
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await toggleCheckbox(page, "Use the deployment's minimum time", false);
  const minSubmit = field(page, "Minimum time before a submit is accepted (milliseconds)");
  await minSubmit.click();
  await minSubmit.fill("7200000");
  // The number field commits on blur rather than per keystroke, which is also what keeps a
  // typed figure from being saved digit by digit on its way to being finished.
  await minSubmit.blur();

  await expect(page.getByTestId("qcms-settings-state")).toContainText("could not be saved", {
    timeout: 30_000,
  });
  // And the screen's one save statement agrees with it rather than still claiming a clean
  // save. Two scopes, one sentence about how the last write went.
  await expect(saveState(page)).toHaveText("The last save failed.");

  // The refused value is still on screen: snapping the control back to what the API kept
  // would hide the very edit the sentence is about.
  // A pattern rather than the digits: the number field formats what it shows, so the
  // assertion is that the figure is still the author's, not that it is unformatted.
  await expect(minSubmit).toHaveValue(/7[\s,.]?200[\s,.]?000/);
});

test("the rule test bench answers with the engine's own verdict", async ({ page }) => {
  // A read-only aid, but the aid is only worth anything if it agrees with the engine, and
  // it agrees by construction: the evaluation happens in the API, on core's own evaluator.
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await page.getByText("Rule test bench").click();
  const bench = page.getByTestId("qcms-bench-outcome");
  // The bench labels each answer control with the pin it is answering for, not "Value":
  // the author is entering an ANSWER to a pinned question, not an operand of a condition.
  await chooseOption(page.locator("body"), `${questionIdFor(AT_FAULT)}@1`, atFaultYesOption);
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(bench).toHaveAttribute("data-outcome", "match", { timeout: 30_000 });
  await expect(bench).toContainText("Matches.");
});

test("both collapsible panels are in the heading outline, with a digest the panel repeats", async ({
  page,
}) => {
  // Issue 519. Two claims, and neither is visible to the axe sweep beside this file:
  // `heading-order` cannot see that a section has NO heading (only that levels skip), and
  // nothing in a rendered tree notices that a digest has become the only copy of a fact.
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  // `plan/admin-ux-audit.md` §4.3: both panels now have an entry in the outline, at the
  // level every other section of this page uses.
  const settingsHeading = page.getByRole("heading", { level: 2, name: "Form settings" });
  const benchHeading = page.getByRole("heading", { level: 2, name: "Rule test bench" });
  await expect(settingsHeading).toBeVisible();
  await expect(benchHeading).toBeVisible();

  // §3.7 on the settings panel: whichever of the two challenge phrases the digest chose,
  // the panel's own checkbox is the fact behind it, so opening the panel finds it again.
  const settingsDigest = await page.getByTestId("qcms-settings-digest").innerText();
  const challenge = page.getByRole("checkbox", { name: "Require a challenge before answering" });
  expect(
    settingsDigest.includes("Challenge required"),
    "the settings digest agrees with the checkbox inside the panel",
  ).toBe(await challenge.isChecked());

  // The bench ships shut, so its digest is what a reader has before opening it - and the
  // count it states is a count of entries that exist inside the panel, which is the shape
  // the audit blesses ("the count in the summary plus the entries inside is fine").
  const benchDigest = page.getByTestId("qcms-bench-digest");
  await expect(benchDigest).toContainText(/reads \d+ question/);
  const reads = Number(/reads (\d+) question/.exec(await benchDigest.innerText())?.[1] ?? "-1");
  await benchHeading.click();
  await expect(page.getByTestId("qcms-bench-reference")).toHaveCount(reads);
});

/** The form library lists what was built, which is the screen the builder is reached from. */
test("the form library lists the forms that were built", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/forms");
  await expect(page.getByRole("table", { name: "Form library" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: insuranceFormId })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: insuranceFormId })).toContainText(
    "Unpublished draft",
  );
});
