import type { Locator, Page } from "@playwright/test";

import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { chooseEnvironment, TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  domShape,
  headingTags,
  withNormalizedInstanceIds,
  type DomShape,
} from "./support/dom-shape.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addRepeatGroup,
  addRule,
  addStep,
  chooseConditionOperator,
  chooseOption,
  chooseRadio,
  closeRuleEditor,
  createForm,
  field,
  groupPanel,
  issue,
  openFormDetails,
  releaseNewestVersion,
  openGroupPanel,
  openRulePhase,
  openStep,
  pickerChoice,
  pickerCommit,
  pinQuestion,
  pinQuestions,
  rule,
  savedStamp,
  usePinRowMenu,
  waitForSaveAfter,
  validationPanel,
  waitForSaved,
} from "./support/forms.js";
import {
  chooseDestination,
  chooseSource,
  openPublishWizard,
  refuseDraftThroughWizard,
} from "./support/publish.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("repeat");

let totpSecret = "";

// Ids cannot be reused, and the harness database survives local reruns.
const RUN = Date.now().toString(36);

const COUNT = `e2e-rp-count-${RUN}`;
const PURPOSE = `e2e-rp-purpose-${RUN}`;
const PASSPORT = `e2e-rp-passport-${RUN}`;
const FARE = `e2e-rp-fare-${RUN}`;
const DECLARATION = `e2e-rp-declaration-${RUN}`;
// Keep an unpinned long-text question: already-pinned rows lack checkboxes regardless of the type filter.
// An unpinned allowed date distinguishes filtering from emptying the entire picker.
const NOTES = `e2e-rp-notes-${RUN}`;
const MEMO = `e2e-rp-memo-${RUN}`;
const SEAT = `e2e-rp-seat-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

const GROUP = "Passengers";

const GROUP_ID = "grp_passengers";

const FORM_SLUG = `e2e-rp-booking-${RUN}`;
let formId = "";

let perInstanceRuleId = "";
let wholeGroupRuleId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

function maxField(page: Page): Locator {
  return field(page, "Maximum instances");
}

test("defines a group, walks all three count sources, and round-trips through save (case 58)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await publishQuestion(page, COUNT, "Number");
  await publishQuestion(page, PURPOSE, "Short text");
  await publishQuestion(page, PASSPORT, "Short text");
  await publishQuestion(page, FARE, "Short text");
  await publishQuestion(page, DECLARATION, "Short text");

  formId = await createForm(page, FORM_SLUG, "Booking");

  await addStep(page, "Trip");
  await pinQuestion(page, questionIdFor(COUNT), 1);

  await addStep(page, "Travellers");
  await pinQuestion(page, questionIdFor(PURPOSE), 1);
  await addRepeatGroup(page, GROUP);
  const panel = groupPanel(page);
  await expect(panel).toHaveAttribute("data-group-id", GROUP_ID);

  await pinQuestions(page, [
    { questionId: questionIdFor(PASSPORT), version: 1 },
    { questionId: questionIdFor(FARE), version: 1 },
  ]);

  await addStep(page, "Declaration");
  await pinQuestion(page, questionIdFor(DECLARATION), 1);
  await openGroupPanel(page, GROUP);

  // Bounded count sources require max: the group maximum bounds the instances a respondent may create.
  await expect(page.getByRole("radio", { name: "The respondent adds and removes" })).toBeChecked();
  await expect(page.getByTestId("qcms-group-max-missing")).toBeVisible();

  await chooseRadio(page, "Always the same number");
  await expect(field(page, "Number of instances")).toBeVisible();
  await expect(maxField(page)).toHaveCount(0);
  await expect(page.getByTestId("qcms-group-max-missing")).toHaveCount(0);
  await fillStable(field(page, "Number of instances"), "3");

  await chooseRadio(page, "From an earlier answer");
  await chooseOption(panel, "Count question", questionIdFor(COUNT));
  await expect(maxField(page)).toBeVisible();

  await chooseRadio(page, "The respondent adds and removes");
  await fillStable(field(page, "Minimum instances"), "1");

  await waitForSaved(page);

  await openFormDetails(page);
  const rejected = validationPanel(page);
  await expect(issue(rejected, "REPEAT_MAX_MISSING")).toBeVisible({ timeout: 30_000 });
  await expect(rejected).toContainText("only limit on how many instances");

  await refuseDraftThroughWizard(page, { formId, environment: "test" });
  await page.goto(`/forms/${formId}`);

  await openGroupPanel(page, GROUP);
  const beforeMax = await savedStamp(page);
  await fillStable(maxField(page), "9");
  await expect(page.getByTestId("qcms-group-max-missing")).toHaveCount(0);

  await fillStable(field(page, "Heading for each instance"), "Passenger {n}");
  await expect(page.getByTestId("qcms-group-label-preview")).toContainText("Passenger 1");

  await fillStable(field(page, "Heading for each instance"), "Passenger {index}");
  await expect(page.getByTestId("qcms-group-label-preview")).toContainText("Passenger {index}");
  await fillStable(field(page, "Heading for each instance"), "Passenger {n}");

  await chooseRadio(page, "A table");
  await chooseRadio(page, "One page per instance");
  await chooseRadio(page, "All instances on one page");

  await waitForSaveAfter(page, beforeMax);

  await page.reload();
  await openGroupPanel(page, GROUP);
  await expect(field(page, "Group name")).toHaveValue(GROUP);
  await expect(field(page, "Heading for each instance")).toHaveValue("Passenger {n}");
  await expect(field(page, "Minimum instances")).toHaveValue("1");
  await expect(maxField(page)).toHaveValue("9");
  await expect(page.getByRole("radio", { name: "The respondent adds and removes" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "All instances on one page" })).toBeChecked();

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

  await expect(page.locator(`[data-pin-question="${questionIdFor(PURPOSE)}"]`)).not.toHaveAttribute(
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

  await expect(page.locator(`[data-rule-scope="${perInstanceRuleId}"]`)).toContainText(
    "evaluated per Passenger",
  );

  const beforeGroupRule = await savedStamp(page);
  wholeGroupRuleId = await addRule(page);
  const groupRule = rule(page, wholeGroupRuleId);

  await chooseConditionOperator(groupRule, "how many instances a group has");
  await expect(groupRule.getByRole("button", { name: /Group$/u })).toBeVisible();
  await chooseOption(groupRule, "Comparison", "is at least");
  await fillStable(groupRule.getByRole("textbox", { name: "Instance count" }), "2");

  await chooseConditionOperator(groupRule, "at least one instance of a group matches");
  await expect(groupRule).toContainText(`For one instance of Passenger`);
  await expect(groupRule.getByRole("button", { name: /Question$/u })).toBeVisible();

  await chooseConditionOperator(groupRule, "every instance of a group matches");

  await chooseOption(groupRule, "Question", `${questionIdFor(PASSPORT)}@1`);
  await expect(groupRule.getByTestId("qcms-every-reading")).toContainText(
    "With no instances at all this is false",
  );
  await expect(groupRule.getByTestId("qcms-every-reading")).toContainText("Negating it");

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

  await chooseOption(bench, "Rule", wholeGroupRuleId);

  const instances = bench.getByRole("textbox", { name: `Instances of ${GROUP}` });
  await expect(instances).toBeVisible();

  await setInstanceCount(instances, "0");
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "noMatch", {
    timeout: 30_000,
  });

  await expect(bench.getByTestId("qcms-bench-reference")).toHaveCount(0);

  await setInstanceCount(instances, "2");
  const prompts = bench.getByTestId("qcms-bench-reference");
  await expect(prompts).toHaveCount(2);

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

  await chooseOption(bench, "Rule", perInstanceRuleId);
  const perInstanceCount = bench.getByRole("textbox", { name: `Instances of ${GROUP}` });
  await setInstanceCount(perInstanceCount, "2");
  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 2)` }),
    "PA2",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  const outcomes = bench.getByTestId("qcms-bench-instance-outcomes");
  await expect(outcomes).toBeVisible({ timeout: 30_000 });
  await expect(outcomes).toContainText("Instance 1: does not match");
  await expect(outcomes).toContainText("Instance 2: matches");

  await setInstanceCount(perInstanceCount, "0");
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(outcomes).toContainText("there are no instances", { timeout: 30_000 });
});

test("expands a group through the portal's own renderer (case 61)", async ({ page, context }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await openPublishWizard(page, formId);
  await chooseSource(page, "The shared draft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, "test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-result")).toContainText(
    /Version \d+ is published\./,
    {
      timeout: 60_000,
    },
  );

  await releaseNewestVersion(page, formId);

  // Compare the same definition and answers through the portal and preview's shared renderer.
  // Use asymmetric instances so per-instance pruning and expansion cannot agree accidentally.

  const portal = await context.newPage();
  await portal.goto(`http://localhost:${String(PORTAL_PORT)}/f/${FORM_SLUG}`);
  await portal.getByRole("button", { name: "Start" }).click();
  await portal.waitForURL(/\/s\/ses_/);

  await expect(portal.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await portal.getByTestId("primary-action").click();
  await expect(portal.getByRole("heading", { name: GROUP })).toBeVisible({ timeout: 60_000 });
  await expect(portal.getByRole("heading", { name: "Passenger 1" })).toBeVisible();
  // Answer only one of two instances so visibility differences between instances are observable.
  await portal.locator('[data-qcms-repeat-action="add"]').click();
  await expect(portal.getByRole("heading", { name: "Passenger 2" })).toBeVisible({
    timeout: 60_000,
  });
  const passports = portal.locator(`input[name$="/${questionIdFor(PASSPORT)}"]`);
  await expect(passports).toHaveCount(2);
  await passports.first().fill("PA1");
  await passports.first().blur();

  await expect(portal.locator(`input[name$="/${questionIdFor(FARE)}"]`)).toHaveCount(1);
  await expect(
    portal
      .locator("fieldset[data-qcms-instance]")
      .nth(0)
      .locator(`input[name$="/${questionIdFor(FARE)}"]`),
  ).toBeVisible();
  await expect(
    portal
      .locator("fieldset[data-qcms-instance]")
      .nth(1)
      .locator(`input[name$="/${questionIdFor(FARE)}"]`),
  ).toHaveCount(0);
  await waitForRenderedStep(portal);

  await expect(portal.locator('[data-qcms-repeat-action="add"]')).toBeEnabled();
  await expect(portal.locator('[data-qcms-repeat-action="remove"]').first()).toBeEnabled();
  const respondent = comparable(await domShape(rendererRoot(portal)));
  await portal.close();

  await chooseEnvironment(page, "test");
  await page.goto(`/forms/${formId}/preview`);
  const surface = page.getByTestId("qcms-preview-surface");
  await expect(surface.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(surface.getByRole("heading", { name: "Passenger 1" })).toBeVisible({
    timeout: 60_000,
  });

  await expect(surface.locator(`input[name$="/${questionIdFor(FARE)}"]`)).toHaveCount(0);

  await setInstanceCount(page.getByRole("textbox", { name: `Instances of ${GROUP}` }), "2");
  await expect(surface.getByRole("heading", { name: "Passenger 2" })).toBeVisible({
    timeout: 60_000,
  });
  const previewPassports = surface.locator(`input[name$="/${questionIdFor(PASSPORT)}"]`);
  await expect(previewPassports).toHaveCount(2);
  await previewPassports.first().fill("PA1");
  await previewPassports.first().blur();
  await expect(surface.locator(`input[name$="/${questionIdFor(FARE)}"]`)).toHaveCount(1);

  await page.waitForFunction(() => {
    const forms = document.querySelectorAll('[data-testid="qcms-preview-surface"] form');
    const form = forms[0];
    if (form === undefined) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });

  await expect(surface.locator('[data-qcms-repeat-action="add"]')).toBeDisabled();
  await expect(surface.locator('[data-qcms-repeat-action="remove"]').first()).toBeDisabled();
  const author = comparable(await domShape(surface.locator("form").first()));

  expect(author.children.length, "the preview should render the group").toBeGreaterThan(0);

  // Embed headings move down one level, except instance headings, whose renderer prop is capped at h4.
  expect(headingTags(respondent), "the compiled step should carry headings").toContain("h4");
  expect(headingTags(author), "the embedded preview demotes by one, clamping the instance").toEqual(
    headingTags(asEmbedded(respondent)),
  );
  expect(headingTags(author), "an embedded document must not claim the page").not.toContain("h1");

  expect(author).toEqual(asEmbedded(respondent));
});

test("filters the column picker to the allowed cell types, and says why (case 62)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await publishQuestion(page, NOTES, "Long text");
  await publishQuestion(page, MEMO, "Long text");
  await publishQuestion(page, SEAT, "Date");

  await page.goto(`/forms/${formId}`);
  await openGroupPanel(page, GROUP);

  await page.getByRole("button", { name: "Add question from library" }).click();
  const stackedPicker = page.getByRole("dialog");
  await expect(stackedPicker).toBeVisible();
  await expect(stackedPicker.getByTestId("qcms-picker-column-note")).toHaveCount(0);
  await expect(pickerChoice(stackedPicker, questionIdFor(MEMO), 1)).toBeVisible();
  const notesChoice = pickerChoice(stackedPicker, questionIdFor(NOTES), 1);
  await expect(notesChoice).toBeVisible();
  await notesChoice.check();
  await pickerCommit(stackedPicker, 1).click();
  await expect(stackedPicker).toBeHidden();

  const beforeTable = await savedStamp(page);
  await chooseRadio(page, "A table");
  const columns = page.getByTestId("table-column-view");
  await expect(columns).toBeVisible();

  const columnRows = columns.locator("tbody tr");
  await expect(columnRows).toHaveCount(3);
  await expect(columns.locator(`tr[data-column="${questionIdFor(PASSPORT)}"]`)).toContainText(
    "Short text",
  );

  const refusedRow = columns.locator(`tr[data-column="${questionIdFor(NOTES)}"]`);
  await expect(refusedRow.getByTestId("column-refused")).toBeVisible();
  await expect(columns.getByTestId("column-types-refused")).toBeVisible();

  const note = columns.getByTestId("column-type-note");
  await expect(note).toContainText("Short text, Number, Date, Yes or no, Single choice");
  await expect(note).toContainText("Present this group as stacked instead");

  await columns.getByRole("button", { name: "Add column" }).click();
  const columnPicker = page.getByRole("dialog");
  await expect(columnPicker).toBeVisible();

  await expect(columnPicker.getByTestId("qcms-picker-column-note")).toContainText(
    "Present this group as stacked instead",
  );

  await expect(pickerChoice(columnPicker, questionIdFor(MEMO), 1)).toHaveCount(0);
  await expect(columnPicker.getByText(questionIdFor(MEMO))).toHaveCount(0);
  await expect(columnPicker.getByText(questionIdFor(NOTES))).toHaveCount(0);

  await expect(pickerChoice(columnPicker, questionIdFor(SEAT), 1)).toBeVisible();
  await columnPicker.getByRole("button", { name: "Cancel" }).click();
  await expect(columnPicker).toBeHidden();

  await waitForSaveAfter(page, beforeTable);
  await openFormDetails(page);
  const rejected = validationPanel(page);
  await expect(issue(rejected, "TABLE_COLUMN_TYPE_NOT_ALLOWED")).toBeVisible({ timeout: 30_000 });
  await expect(rejected).toContainText("presentation to stacked");
  await refuseDraftThroughWizard(page, { formId, environment: "test" });
  await page.goto(`/forms/${formId}`);

  await openGroupPanel(page, GROUP);
  await usePinRowMenu(page, questionIdFor(NOTES), "remove");
  await expect(columns.locator(`tr[data-column="${questionIdFor(NOTES)}"]`)).toHaveCount(0);
  await expect(columns.getByTestId("column-types-refused")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "A table" })).toBeChecked();

  await chooseRadio(page, "All instances on one page");
  await expect(columns).toHaveCount(0);
  await page.getByRole("button", { name: "Add question from library" }).click();
  const reopened = page.getByRole("dialog");
  await expect(pickerChoice(reopened, questionIdFor(MEMO), 1)).toBeVisible();
  await reopened.getByRole("button", { name: "Cancel" }).click();
});

test("previews a one-page-per-instance group one instance per page, named in the step line (076)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/forms/${formId}`);
  await openGroupPanel(page, GROUP);
  const beforePaginate = await savedStamp(page);
  await chooseRadio(page, "One page per instance");
  await waitForSaveAfter(page, beforePaginate);

  await page.goto(`/forms/${formId}/preview`);
  const surface = page.getByTestId("qcms-preview-surface");
  const stepLine = page.getByTestId("qcms-preview-step");
  await expect(surface.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await setInstanceCount(page.getByRole("textbox", { name: `Instances of ${GROUP}` }), "2");

  await page.getByRole("button", { name: "Next step" }).click();
  await expect(stepLine).toHaveText(/^Step 2 of \d+: Travellers, Passenger 1$/, {
    timeout: 60_000,
  });
  await expect(surface.locator("fieldset[data-qcms-instance]")).toHaveCount(1);
  await expect(surface.getByRole("heading", { name: "Passenger 1" })).toBeVisible();
  await expect(surface.getByRole("heading", { name: "Passenger 2" })).toHaveCount(0);

  await page.getByRole("button", { name: "Next step" }).click();
  await expect(stepLine).toHaveText(/^Step 3 of \d+: Travellers, Passenger 2$/);
  await expect(surface.locator("fieldset[data-qcms-instance]")).toHaveCount(1);
  await expect(surface.getByRole("heading", { name: "Passenger 2" })).toBeVisible();
  await expect(surface.getByRole("heading", { name: "Passenger 1" })).toHaveCount(0);
});

// React Aria NumberField commits on blur or Enter; fill alone leaves the previous roster count.
async function setInstanceCount(field: Locator, count: string): Promise<void> {
  await field.fill(count);
  await field.press("Enter");
  await expect(field).toHaveValue(count);
}

// Normalise generated instance ids and the portal cursor's heading tabindex.
// Remove disabled only from roster controls after asserting the intentional preview difference.
// Drop transient roster status text while comparing the live-region element itself.
function comparable(shape: DomShape): DomShape {
  const normalise = (node: DomShape): DomShape => {
    const isRosterAction = node.attrs["data-qcms-repeat-action"] !== undefined;
    const isStatusRegion = node.attrs["role"] === "status";
    return {
      ...node,
      ...(isStatusRegion ? { text: "" } : {}),
      attrs: Object.fromEntries(
        Object.entries(node.attrs).filter(
          ([name]) => name !== "tabindex" && !(isRosterAction && name === "disabled"),
        ),
      ),
      children: node.children.map(normalise),
    };
  };
  return normalise(withNormalizedInstanceIds(shape));
}

const INSTANCE_HEADING_CEILING = 4;

const HEADING_FLOOR = 6;

// Instance heading props are constrained to h1..h4, unlike ordinary Text headings.
// Apply the h4 ceiling only inside the instance legend when demoting the embed.
function asEmbedded(shape: DomShape): DomShape {
  const walk = (node: DomShape, ceiling: number): DomShape => {
    const inner = node.tag === "legend" ? INSTANCE_HEADING_CEILING : ceiling;
    return {
      ...node,
      tag: demotedTag(node.tag, inner),
      children: node.children.map((child) => walk(child, inner)),
    };
  };
  return walk(shape, HEADING_FLOOR);
}

function demotedTag(tag: string, ceiling: number): string {
  const level = /^h([1-6])$/u.exec(tag)?.[1];
  if (level === undefined) return tag;
  return `h${String(Math.min(Number(level) + 1, ceiling))}`;
}

function rendererRoot(page: Page): Locator {
  return page.getByTestId("step-card").locator("form").last();
}

// Probe the rendered-step form used for comparison, not the separately hydrated header form.
// React's __reactFiber property proves that the compared node is attached.
async function waitForRenderedStep(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const forms = document.querySelectorAll('[data-testid="step-card"] form');
    const form = forms[forms.length - 1];
    if (form === undefined) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });
}
