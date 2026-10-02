import type { Locator, Page } from "@playwright/test";

import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  domShape,
  headingTags,
  withDemotedHeadings,
  withNormalizedInstanceIds,
} from "./support/dom-shape.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addRepeatGroup,
  addRule,
  addStep,
  chooseOption,
  chooseRadio,
  closeRuleEditor,
  createForm,
  field,
  groupPanel,
  issue,
  openFormDetails,
  openGroupPanel,
  openRulePhase,
  openStep,
  pinQuestions,
  rule,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Authoring a repeating group, driven through the browser (task 074; acceptance cases 58 to 61
 * of `plan/repeating-groups-and-table-input.md` section 11).
 *
 * ## Why one journey rather than four specs
 *
 * The four cases are one authoring loop and each depends on the previous one's output: there is
 * no rule to put a scope chip on until a group exists, nothing for the bench to count until a
 * rule reads a group, and nothing for the portal to serve until the form is published. Building
 * the form four times would be the slowest part of the run and would prove nothing extra.
 *
 * ## What is NOT here, and why
 *
 * The question editor. ADR-42's load-bearing property is that a question does not know it is
 * repeated: `QUESTION_TYPES` is unchanged, no component is registered, and the five questions
 * below are authored by the ordinary `createDraft` helper every other spec uses. That absence is
 * the dividend, so the spec that would have exercised a new question type is the spec that does
 * not exist.
 *
 * Case 62 - the library picker filtered to the allowed cell types - belongs to task 077, because
 * it is the table presentation's own publish refusal being surfaced rather than group authoring
 * in general. This spec's panel offers the presentation switch and nothing behind the table
 * option.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("repeat");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Ids are never reused (R6) and the harness database survives a local rerun. */
const RUN = Date.now().toString(36);

const COUNT = `e2e-rp-count-${RUN}`;
const PURPOSE = `e2e-rp-purpose-${RUN}`;
const PASSPORT = `e2e-rp-passport-${RUN}`;
const FARE = `e2e-rp-fare-${RUN}`;
const DECLARATION = `e2e-rp-declaration-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/** The group the whole spec is about, named as an author would name it. */
const GROUP = "Passengers";
/** The id `addGroup` mints from that name, asserted rather than assumed on first use. */
const GROUP_ID = "grp_passengers";

const FORM_SLUG = `e2e-rp-booking-${RUN}`;
let formId = "";

/**
 * The two rules the scope test authors, by the ids the builder MINTED for them.
 *
 * Read off the open wizard rather than written out, for the reason `addRule` records: a rule id is
 * minted from the question the rule starts against, so hard-coding one here would be asserting
 * this spec's guess about `mintId` rather than the rule the builder actually made.
 */
let perInstanceRuleId = "";
let wholeGroupRuleId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Author one question and publish v1. */
async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

/** The maximum field, which is required on both bounded count sources (Q4 as amended by Q14). */
function maxField(page: Page): Locator {
  return field(page, "Maximum instances");
}

test("defines a group, walks all three count sources, and round-trips through save (case 58)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // A form can only pin PUBLISHED versions (022). Five questions: a number for the
  // `fromAnswer` count source, one beside it, two inside the group, and one after its span.
  await publishQuestion(page, COUNT, "Number");
  await publishQuestion(page, PURPOSE, "Short text");
  await publishQuestion(page, PASSPORT, "Short text");
  await publishQuestion(page, FARE, "Short text");
  await publishQuestion(page, DECLARATION, "Short text");

  formId = await createForm(page, FORM_SLUG, "Booking");

  await addStep(page, "Trip");
  await pinQuestions(page, [
    { questionId: questionIdFor(COUNT), version: 1 },
    { questionId: questionIdFor(PURPOSE), version: 1 },
  ]);

  await addStep(page, "Travellers");
  await addRepeatGroup(page, GROUP);
  const panel = groupPanel(page);
  await expect(panel).toHaveAttribute("data-group-id", GROUP_ID);

  // The two member questions, pinned through the same library picker a step's own pins go
  // through - which is ADR-42's property as a gesture: a group member is pinned, versioned and
  // listed exactly as a step's pin is.
  await pinQuestions(page, [
    { questionId: questionIdFor(PASSPORT), version: 1 },
    { questionId: questionIdFor(FARE), version: 1 },
  ]);

  // --- the count source, all three of them ---------------------------------
  //
  // A fresh group is `open` with no maximum, which is the one state publish refuses: `max` is
  // required on both bounded sources because a group's own maximum is the only bound on how many
  // instances a respondent may create (SEC-16). The panel says so where the field is.
  await expect(page.getByRole("radio", { name: "The respondent adds and removes" })).toBeChecked();
  await expect(page.getByTestId("qcms-group-max-missing")).toBeVisible();

  // FIXED shows no maximum AT ALL, rather than a disabled one: the count is its own bound, so a
  // second field would be a control with nothing it could mean.
  await chooseRadio(page, "Always the same number");
  await expect(field(page, "Number of instances")).toBeVisible();
  await expect(maxField(page)).toHaveCount(0);
  await expect(page.getByTestId("qcms-group-max-missing")).toHaveCount(0);
  await fillStable(field(page, "Number of instances"), "3");

  // FROM AN EARLIER ANSWER offers the number questions pinned strictly before this group's span
  // and outside every group. Both halves are publish refusals pre-empted at the control:
  // `REPEAT_COUNT_BACKWARD_REF` and `REPEAT_COUNT_INSIDE_GROUP`.
  await chooseRadio(page, "From an earlier answer");
  await chooseOption(panel, "Count question", questionIdFor(COUNT));
  await expect(maxField(page)).toBeVisible();

  // OPEN, which is the presentation 073 serves and the one this spec publishes.
  await chooseRadio(page, "The respondent adds and removes");
  await fillStable(field(page, "Minimum instances"), "1");

  // --- the publish refusal, read where an author meets it ------------------
  //
  // Asserted BEFORE the maximum is filled in, because that is the state the author is actually
  // in: the field is marked required, the grid flags the group, and publish refuses with
  // `REPEAT_MAX_MISSING` naming the group rather than the form.
  await waitForSaved(page);
  await openFormDetails(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Publish v/ })
    .click();
  const rejected = page.getByTestId("qcms-publish-rejected");
  await expect(rejected).toBeVisible({ timeout: 30_000 });
  await expect(issue(rejected, "REPEAT_MAX_MISSING")).toBeVisible();
  await expect(rejected).toContainText("only limit on how many instances");

  // --- the maximum, the instance heading, and the presentation -------------
  await openGroupPanel(page, GROUP);
  const beforeMax = await savedStamp(page);
  await fillStable(maxField(page), "9");
  await expect(page.getByTestId("qcms-group-max-missing")).toHaveCount(0);

  // The instance heading, with the live preview. `{n}` is the live one-based ordinal and the only
  // placeholder the kernel substitutes, so the preview puts a 1 in it and nothing else.
  await fillStable(field(page, "Heading for each instance"), "Passenger {n}");
  await expect(page.getByTestId("qcms-group-label-preview")).toContainText("Passenger 1");

  // An unknown placeholder previews WITH ITS BRACES, which is the honest rendering: a respondent
  // would read them too, and it is `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN` at publish. A preview
  // that silently dropped the token would hide the refusal it exists to make visible.
  await fillStable(field(page, "Heading for each instance"), "Passenger {index}");
  await expect(page.getByTestId("qcms-group-label-preview")).toContainText("Passenger {index}");
  await fillStable(field(page, "Heading for each instance"), "Passenger {n}");

  // All three presentations are offered, because the field is the kernel's and the choice is a
  // LAYOUT: switching changes no answer, no key and no id (ADR-42). This spec leaves it stacked,
  // which is the presentation 073 serves; what sits behind the other two is 076's and 077's.
  await chooseRadio(page, "A table");
  await chooseRadio(page, "One page per instance");
  await chooseRadio(page, "All instances on one page");

  await waitForSaveAfter(page, beforeMax);

  // --- the round trip ------------------------------------------------------
  //
  // The draft is on the server, not just on screen: a reload rebuilds it from the API, and every
  // field the panel set is read back from that rebuild.
  await page.reload();
  await openGroupPanel(page, GROUP);
  await expect(field(page, "Group name")).toHaveValue(GROUP);
  await expect(field(page, "Heading for each instance")).toHaveValue("Passenger {n}");
  await expect(field(page, "Minimum instances")).toHaveValue("1");
  await expect(maxField(page)).toHaveValue("9");
  await expect(page.getByRole("radio", { name: "The respondent adds and removes" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "All instances on one page" })).toBeChecked();

  // THE GRID STATES THE SPAN, and the step editor is where an author scans a step: the boundary
  // row names the group, counts its members and says what decides its size, and the member rows
  // follow it marked with the group they sit in.
  await openStep(page, "Travellers");
  const boundary = page.locator(`[data-pin-group-boundary="${GROUP_ID}"]`);
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText("Repeating group: Passengers");
  await expect(boundary).toContainText("2 questions");
  await expect(boundary).toContainText("respondent adds, 1 to 9");
  await expect(page.locator(`[data-pin-question="${questionIdFor(PASSPORT)}"]`)).toHaveAttribute(
    "data-pin-group",
    GROUP_ID,
  );
  // The step's own pins are outside it, which is what makes the boundary mean something.
  await openStep(page, "Trip");
  await expect(page.locator(`[data-pin-question="${questionIdFor(COUNT)}"]`)).not.toHaveAttribute(
    "data-pin-group",
    GROUP_ID,
  );
});

test("states the scope on a per-instance rule, and offers all three group operators (case 59)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  // --- the scope chip ------------------------------------------------------
  //
  // Scope is implicit BY POSITION (ADR-42 section 3.4): a rule whose target sits inside a group
  // is evaluated once per live instance, and the condition the author wrote says nothing about
  // that. The chip is what pays for keeping the DSL small, so it is a deliverable rather than a
  // decoration - and the noun is the author's own, taken from their instance heading.
  const beforeScoped = await savedStamp(page);
  perInstanceRuleId = await addRule(page);
  const scoped = rule(page, perInstanceRuleId);
  await chooseOption(scoped, "Question", `${questionIdFor(PASSPORT)}@1`);
  await openRulePhase(page, "then");
  await scoped.getByText(questionIdFor(FARE), { exact: true }).click();
  await expect(page.getByTestId("qcms-rule-scope")).toContainText("evaluated per Passenger");
  await expect(page.getByTestId("qcms-rule-scope")).toContainText("once for each Passenger");
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeScoped);

  // And it reads on the rules table too, which is the screen an author answers "what does this
  // form do" from: a per-passenger rule reads very differently from a whole-form one.
  await expect(page.locator(`[data-rule-scope="${perInstanceRuleId}"]`)).toContainText(
    "evaluated per Passenger",
  );

  // --- the three structured editors ----------------------------------------
  const beforeGroupRule = await savedStamp(page);
  wholeGroupRuleId = await addRule(page);
  const groupRule = rule(page, wholeGroupRuleId);

  // `instanceCount` is a group picker, a comparison picker and a number. The comparison reuses
  // the ORDERING operators' own names as a field rather than a second vocabulary.
  await chooseOption(groupRule, "Operator", "how many instances a group has");
  await expect(groupRule.getByRole("button", { name: /Group$/u })).toBeVisible();
  await chooseOption(groupRule, "Comparison", "is at least");
  await fillStable(groupRule.getByRole("textbox", { name: "Instance count" }), "2");

  // `anyInstance` is a group picker plus a NESTED condition, which is the editor's own recursion:
  // the nested tree is addressed as child 0 exactly as `not`'s is, so it reuses the depth
  // accounting rather than keeping a second one.
  await chooseOption(groupRule, "Operator", "at least one instance of a group matches");
  await expect(groupRule).toContainText(`For one instance of Passenger`);
  await expect(groupRule.getByRole("button", { name: /Question$/u })).toBeVisible();

  // `everyInstance` states its EMPTY-GROUP READING at the control, because the editor is where
  // an author decides to use the operator (Q7, ruled 2026-09-29).
  await chooseOption(groupRule, "Operator", "every instance of a group matches");
  // The nested condition reads a question INSIDE the group, which resolves per instance - the
  // airline's "every passenger holds a passport" written as an ordinary condition.
  await chooseOption(groupRule, "Question", `${questionIdFor(PASSPORT)}@1`);
  await expect(groupRule.getByTestId("qcms-every-reading")).toContainText(
    "With no instances at all this is false",
  );
  await expect(groupRule.getByTestId("qcms-every-reading")).toContainText("Negating it");

  // Its target has to follow the group's WHOLE SPAN, which is forward-only rule 2 applied to a
  // span rather than to a position - so the question after the group is offered and a member of
  // the group is not.
  await openRulePhase(page, "then");
  await expect(
    groupRule.getByRole("checkbox", { name: questionIdFor(DECLARATION), exact: true }),
  ).toBeEnabled();
  await groupRule.getByText(questionIdFor(DECLARATION), { exact: true }).click();
  await expect(
    groupRule.getByRole("checkbox", { name: questionIdFor(FARE), exact: true }),
  ).toBeDisabled();
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeGroupRule);

  // A whole-form target carries no chip, which is the other half of the chip meaning anything.
  await expect(page.locator(`[data-rule-scope="${wholeGroupRuleId}"]`)).toHaveCount(0);
});

test("evaluates a rule against hypothetical instances, including zero (case 60)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/rules`);

  const bench = page.getByTestId("qcms-bench-screen");
  await expect(bench).toBeVisible();

  // The `everyInstance` rule, which is the one the Q7 ruling exists for.
  await chooseOption(bench, "Rule", wholeGroupRuleId);
  const instances = bench.getByRole("spinbutton", { name: `Instances of ${GROUP}` });
  await expect(instances).toBeVisible();

  // --- ZERO INSTANCES, which is the ruled case and the one nobody thinks to try ---
  //
  // `everyInstance` over a group with no live instance is FALSE, not vacuously true: "every
  // passenger holds a passport" is not a true statement about a booking with no passengers. The
  // bench is where that becomes discoverable rather than documented.
  await instances.fill("0");
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "noMatch", {
    timeout: 30_000,
  });
  // With no instance there is no per-instance answer to prompt for either, which is the honest
  // rendering of a group with nothing in it.
  await expect(bench.getByTestId("qcms-bench-reference")).toHaveCount(0);

  // --- two instances, answered -------------------------------------------
  await instances.fill("2");
  const prompts = bench.getByTestId("qcms-bench-reference");
  await expect(prompts).toHaveCount(2);
  // One control per instance, named for the instance it answers: six passenger fields that all
  // answered to one label would be six fields nobody could tell apart.
  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 1)` }),
    "PA1",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "noMatch", {
    timeout: 30_000,
  });

  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 2)` }),
    "PA2",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "match", {
    timeout: 30_000,
  });

  // --- a PER-INSTANCE rule reports one verdict per instance ---------------
  //
  // The rule whose target sits inside the group. This is the surface where an author finds out
  // that a rule they wrote reads one instance rather than the whole group, and the other way
  // round.
  await chooseOption(bench, "Rule", perInstanceRuleId);
  const perInstanceCount = bench.getByRole("spinbutton", { name: `Instances of ${GROUP}` });
  await perInstanceCount.fill("2");
  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 2)` }),
    "PA2",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  const outcomes = bench.getByTestId("qcms-bench-instance-outcomes");
  await expect(outcomes).toBeVisible({ timeout: 30_000 });
  await expect(outcomes).toContainText("Instance 1: does not match");
  await expect(outcomes).toContainText("Instance 2: matches");

  // And at zero instances it says so in words rather than rendering nothing: a list that
  // disappeared would leave the author looking at one verdict with no sign that it was a verdict
  // about no instances at all.
  await perInstanceCount.fill("0");
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(outcomes).toContainText("there are no instances", { timeout: 30_000 });
});

test("expands a group through the portal's own renderer (case 61)", async ({ page, context }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // The form has to be published for a respondent to have anything to compare against, and the
  // two rules authored above are legal, so this is the first clean publish of it.
  await page.goto(`/forms/${formId}`);
  await openFormDetails(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Publish v/ })
    .click();
  await expect(page.getByText(/^Published as v/)).toBeVisible({ timeout: 60_000 });

  /**
   * ## What is compared, and why it is the same document
   *
   * One definition seen from two sides. The **portal** serves the compiled documents stored at
   * publish time (ADR-18), projected onto the API's qualified `visibleQuestions` and expanded
   * per live instance by `A2UIStepRenderer`. The **admin preview** compiles the same definition
   * and draws it with the same projection, the same expansion and the same renderer - from a
   * roster it mints itself, because a preview has no session to take one from.
   *
   * A repeating group is the sharpest version of this assertion, because the expansion is the
   * only transform in the stack that reads the STORED TEMPLATE: the compiler is answer-blind and
   * emits the member controls once, so a second expansion written for the admin would be the one
   * part of the preview that could disagree with what a respondent gets. If `expandRepeatGroups`
   * is genuinely shared the two subtrees are identical, and this says so.
   *
   * ## The two deliberate differences
   *
   * **Heading levels**, as the non-repeating comparison already asserts (issue #537): the portal
   * serves the document as the whole page and the admin embeds it, so the author's side is
   * demoted by exactly one level. Asserted rather than normalized away.
   *
   * **Instance ids**, which are a generated identity in the same category as the `id` and
   * react-aria values `support/dom-shape.ts` already drops. The portal's come out of the
   * session's instance ledger and the preview mints `ins_p1`; they are normalized positionally on
   * both sides, so the comparison still notices a different NUMBER of instances or a different
   * order. See `withNormalizedInstanceIds`.
   *
   * ## Why both sides show one instance
   *
   * The group is `open` with `min: 1`. Serving a step mints `min` (or one) the first time, so a
   * respondent sees a card to fill rather than an empty group and a button; the preview's own
   * default is the same `min`. Neither side is told the number by this test, which is the point -
   * they agree because they read the same declaration.
   */

  // --- the respondent's side ------------------------------------------------
  const portal = await context.newPage();
  await portal.goto(`http://localhost:${String(PORTAL_PORT)}/f/${FORM_SLUG}`);
  await portal.getByRole("button", { name: "Start" }).click();
  await portal.waitForURL(/\/s\/ses_/);
  // Walk to the step the group is on: the trip questions come first.
  await expect(portal.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await portal.getByRole("button", { name: "Continue" }).click();
  await expect(portal.getByRole("heading", { name: GROUP })).toBeVisible({ timeout: 60_000 });
  await expect(portal.getByRole("heading", { name: "Passenger 1" })).toBeVisible();
  await waitForRenderedStep(portal);
  const respondent = withNormalizedInstanceIds(await domShape(rendererRoot(portal)));
  await portal.close();

  // --- the author's side ----------------------------------------------------
  await page.goto(`/forms/${formId}/preview`);
  const surface = page.getByTestId("qcms-preview-surface");
  await expect(surface.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(surface.getByRole("heading", { name: "Passenger 1" })).toBeVisible({
    timeout: 60_000,
  });
  const author = withNormalizedInstanceIds(await domShape(surface.locator("form").first()));

  // A sanity check first, so a failure below reads as a divergence rather than as two empty trees
  // agreeing with each other.
  expect(author.children.length, "the preview should render the group").toBeGreaterThan(0);

  // The embed's one deliberate difference, stated before the deep comparison so a regression in
  // it reads as "the headings moved" rather than as an unexplained tree diff. A group's own label
  // is an h3 and an instance's is an h4 as the page; embedded, they are an h4 and an h5.
  expect(headingTags(author), "the embedded preview demotes by exactly one level").toEqual(
    headingTags(withDemotedHeadings(respondent, 1)),
  );
  expect(headingTags(author), "an embedded document must not claim the page").not.toContain("h1");

  expect(author).toEqual(withDemotedHeadings(respondent, 1));
});

/** The rendered step on the portal, which is the subtree the comparison reads. */
function rendererRoot(page: Page): Locator {
  return page.getByTestId("step-card").locator("form").last();
}

/**
 * Wait until React owns the RENDERED STEP, so the shape read is the hydrated one.
 *
 * React tags every host node it owns with a `__reactFiber$...` property, which is the attachment
 * signal itself rather than a proxy for it. Comparing a server-rendered tree against a hydrated
 * one would be comparing two different things and would fail for a reason that is not fidelity.
 *
 * It probes the same element {@link rendererRoot} reads, which is not "the first form on the
 * page": the portal's header carries the no-JS appearance form, and probing that one answers yes
 * while the step below is still the pre-hydration fallback (issue #195).
 */
async function waitForRenderedStep(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const forms = document.querySelectorAll('[data-testid="step-card"] form');
    const form = forms[forms.length - 1];
    if (form === undefined) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });
}
