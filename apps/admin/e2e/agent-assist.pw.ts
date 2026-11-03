import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { waitForHydration } from "./support/hydration.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { pinProposalClock } from "./support/agent.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  openStep,
  pinLabel,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { chooseDestination, chooseSource, openPublishWizard } from "./support/publish.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

// The fake provider retains production dispatch, validation and SSE relay.
// The search directive isolates this run's library fixtures in the shared database.

const ASSIST_STORAGE = {
  ...TEST_ENVIRONMENT_STORAGE,
  cookies: [
    ...TEST_ENVIRONMENT_STORAGE.cookies,
    {
      name: "qcms-assistant",
      value: "open:400",
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    },
  ],
};

test.use({ storageState: ASSIST_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("assist");

let totpSecret = "";

// Mint ids per attempt: retries rerun setup in a persistent database, and ids cannot be reused.
// Reusing a search tag would also include a previous attempt's questions.
let RUN = "";
let attempt = 0;

let FIRST = "";
let SECOND = "";

let NEEDLE = "";

const FIRST_LABEL = "E2E Single choice question";
const SECOND_LABEL = "E2E Number question";
const YES_LABEL = "Yes, always";

let formId = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  attempt += 1;
  RUN = `${Date.now().toString(36)}x${String(attempt)}`;
  FIRST = `e2e-assist-${RUN}-a`;
  SECOND = `e2e-assist-${RUN}-b`;
  NEEDLE = `e2e-assist-${RUN}-`;
  await createTestAdmin(EMAIL);
});

test.beforeEach(async ({ page }) => {
  await pinProposalClock(page);
});

async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

function composer(page: Page) {
  return page.getByTestId("qcms-assistant-composer");
}

async function send(page: Page, message: string): Promise<void> {
  await fillStable(composer(page), message);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
}

test("proposes a form, accepts it into the draft, and publishes it (exit criterion 3)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await publishQuestion(page, FIRST, "Single choice");
  await publishQuestion(page, SECOND, "Number");

  formId = await createForm(page, `e2e-assist-quote-${RUN}`, "Vehicle insurance quote");

  await addStep(page, "Start");
  await pinQuestion(page, questionIdFor(FIRST), 1);
  await waitForSaved(page);

  const panel = page.getByTestId("qcms-assistant-panel");
  await expect(panel).toBeVisible();

  await send(
    page,
    `a vehicle-insurance quote where an at-fault accident opens a follow-up #qcms-fake-search:${NEEDLE}`,
  );

  const proposal = page.getByTestId("qcms-acard-draft");
  await expect(proposal).toBeVisible({ timeout: 60_000 });

  const steps = page.getByTestId("qcms-assistant-steps").locator("li");
  await expect(steps).toHaveCount(3, { timeout: 30_000 });
  await expect(
    page.getByTestId("qcms-assistant-steps").locator("li[data-state='done']"),
  ).toHaveCount(3);
  await expect(steps.first()).toContainText("Searching the question library");

  const diff = page.getByTestId("qcms-acard-diff");

  await expect(diff.locator("summary").filter({ hasText: "Driving history" })).toBeVisible();
  await expect(diff.locator("summary").filter({ hasText: /rule/iu })).not.toHaveCount(0);
  await expect(diff.locator("summary").filter({ hasText: /^Added:/u })).not.toHaveCount(0);

  await expect(page.getByTestId("qcms-acard-issues")).toContainText("validation passes", {
    ignoreCase: true,
  });

  await expect(panel.getByRole("button", { name: /publish/iu })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /erase|webhook|link/iu })).toHaveCount(0);

  // Save helpers visit the form screen for its strip and return to the selected step.
  // Compare saved-at instants: a Last saved sentence can describe an earlier edit.
  const previousSave = await savedStamp(page);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  await waitForSaveAfter(page, previousSave);

  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();
});

test("publishes the accepted draft through the unchanged human flow (exit criterion 3)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible({ timeout: 30_000 });

  await openPublishWizard(page, formId);
  await chooseSource(page, "The shared draft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, "test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await expect(page.getByTestId("qcms-publish-provenance")).toBeVisible();

  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-result")).toContainText("Version 1 is published.", {
    timeout: 60_000,
  });
});

test("walks the proposed branch in the preview pane (exit criterion 3)", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/preview`);

  const preview = page.getByTestId("qcms-draft-preview");
  await expect(preview.getByText(FIRST_LABEL)).toBeVisible({ timeout: 60_000 });

  await expect(preview.getByText(SECOND_LABEL)).toHaveCount(0);
  await preview.getByText(YES_LABEL, { exact: true }).click();
  await expect(preview.getByText(SECOND_LABEL)).toBeVisible({ timeout: 30_000 });
});

test("refuses a scripted rogue tool call and proposes nothing (exit criterion 4)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });
  await send(page, "#qcms-fake:rogue-publish publish this for me");

  await expect(page.getByTestId("qcms-assistant-error")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("qcms-acard-draft")).toHaveCount(0);
});

test("header tooltips stay open across the gap and close on Escape from anywhere (SC 1.4.13)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });

  await waitForHydration(page);

  const toggle = page.getByTestId("qcms-assistant-close");
  const tip = page.getByTestId("qcms-assist-tip");

  // hover waits for the dock to settle; coordinates sampled before layout settles can miss the control.
  await toggle.hover();
  await expect(tip).toBeVisible();

  const button = await toggle.boundingBox();
  if (button === null) throw new Error("the Close control has no box");
  const x = button.x + button.width / 2;
  const tipBox = await tip.boundingBox();
  if (tipBox === null) throw new Error("the tooltip has no box");

  expect(tipBox.y).toBeLessThanOrEqual(button.y + button.height + 0.5);
  expect(tipBox.x).toBeLessThanOrEqual(x);
  expect(tipBox.x + tipBox.width).toBeGreaterThanOrEqual(x);

  await page.mouse.move(x, button.y + button.height + 2, { steps: 4 });

  await page.waitForTimeout(500);
  await expect(tip).toBeVisible();
  await page.mouse.move(x, tipBox.y + tipBox.height - 4, { steps: 4 });
  await page.waitForTimeout(500);
  await expect(tip).toBeVisible();

  await page.mouse.move(x, tipBox.y + tipBox.height + 120, { steps: 4 });
  await expect(tip).toBeHidden();

  const field = composer(page);
  await field.focus();
  await page.mouse.move(x, button.y + button.height / 2);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(field).toBeFocused();

  await page.mouse.move(x, tipBox.y + tipBox.height + 120);
  await toggle.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("streams prose and a running step before the first tool result (exit criterion 1)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, `#qcms-fake:narrate-then-tools #qcms-fake-search:${NEEDLE} add a step`);

  const live = page.getByTestId("qcms-assistant-streaming");
  await expect(live).toContainText("question library", { timeout: 30_000 });

  await expect(
    page.getByTestId("qcms-assistant-steps").locator("li[data-state='running']"),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(
    page.getByTestId("qcms-assistant-steps").locator("li[data-state='done']"),
  ).toHaveCount(0);

  const mark = page.getByTestId("qcms-assist-mark").first();
  await expect(mark).toHaveAttribute("data-working", "true");

  await expect(page.getByTestId("qcms-acard-draft")).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId("qcms-assistant-steps").locator("li[data-state='done']"),
  ).toHaveCount(3);
  await expect(mark).not.toHaveAttribute("data-working", "true");

  await expect(page.getByTestId("qcms-assistant-panel")).toHaveAccessibleName("Assistant");

  const results = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assistant-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
    ),
    "axe violations on a streamed assistant turn",
  ).toEqual([]);
});

test("Stop ends a running turn with no error shown (exit criterion 5)", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, "#qcms-fake:step-limit keep going");

  const stop = page.getByTestId("qcms-assistant-stop").locator("button");
  await expect(stop).toBeVisible({ timeout: 30_000 });
  // Use the keyboard: this script keeps moving the Stop control, so pointer actionability never settles.
  await stop.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("qcms-assistant-stop")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("qcms-assistant-streaming")).toHaveCount(0);
  await expect(page.getByTestId("qcms-assistant-error")).toHaveCount(0);

  await expect(composer(page)).toBeEnabled();
});

test("Enter sends and Shift+Enter adds a line (exit criterion 5)", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });

  await waitForHydration(page);

  const field = composer(page);
  await field.click();
  await page.keyboard.insertText("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("second");
  await expect(field).toHaveValue("first\nsecond");

  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("qcms-assistant-turns")).toContainText("first", {
    timeout: 30_000,
  });
});

// Reasoning frames require the harness API's QCMS_AGENT_THINKING=summary setting.
test("shows the thinking disclosure, collapsed and in plain text (081 exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, `#qcms-fake:reasoning #qcms-fake-search:${NEEDLE} add a step`);

  const disclosure = page.getByTestId("qcms-assistant-thinking").first();
  await expect(disclosure).toBeVisible({ timeout: 60_000 });

  await expect(disclosure).toContainText("Thinking");
  await expect(disclosure).toContainText(/Thought for \d+ s/u, { timeout: 60_000 });

  const closed = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assistant-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    closed.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    "axe violations with the thinking disclosure closed",
  ).toEqual([]);

  await disclosure.locator("summary").click();
  await expect(disclosure).toContainText("qcms-reasoning-sentinel-7f3a");
  await expect(disclosure).toContainText("**qcms-reasoning-sentinel-7f3a**");
  await expect(disclosure.locator("strong")).toHaveCount(0);

  const open = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assistant-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    open.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    "axe violations with the thinking disclosure open",
  ).toEqual([]);
});

test("runs no animation under reduced motion (exit criterion 8)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assistant-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, "#qcms-fake:step-limit keep going");
  await expect(page.getByTestId("qcms-assistant-streaming")).toBeVisible({ timeout: 30_000 });

  const animated = await page.evaluate(() => {
    const names: string[] = [];
    const check = (label: string, element: Element) => {
      const style = getComputedStyle(element);
      if (style.animationName !== "none" && style.animationName !== "") {
        names.push(`${label}: ${style.animationName}`);
      }
    };
    for (const selector of [
      ".qcms-assist-caret",
      ".qcms-assist-steps__pulse",
      '.qcms-assist-mark[data-working="true"] .qcms-assist-mark__light',
    ]) {
      for (const element of document.querySelectorAll(selector)) check(selector, element);
    }

    const probe = document.createElement("span");
    probe.className = "qcms-assist-think__pulse";
    document.body.append(probe);
    check(".qcms-assist-think__pulse", probe);
    probe.remove();

    return names;
  });
  expect(animated, "animations still running under prefers-reduced-motion: reduce").toEqual([]);

  const mark = page.getByTestId("qcms-assist-mark").first();
  await expect(mark).toHaveAttribute("data-working", "true");

  const results = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assistant-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => v.id),
    "axe violations on a streaming turn under reduced motion",
  ).toEqual([]);
});

// Use a separate form: the shared published fixtures are read by later tests.
// An invented question leaves its pin unpublished until the question itself is published.
test("accepting a proposal creates its new question as an unpublished library draft (#823)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const newFormId = await createForm(page, `e2e-assist-new-q-${RUN}`, "Onboarding");

  await addStep(page, "Start");
  await pinQuestion(page, questionIdFor(FIRST), 1);
  await waitForSaved(page);

  const proposedId = `q_fake_new_${RUN.replace(/[^a-z0-9_]/gu, "")}`;

  await send(page, `#qcms-fake:propose-questions #qcms-fake-new:${RUN} add a name question`);

  const proposal = page.getByTestId("qcms-acard-draft");
  await expect(proposal).toBeVisible({ timeout: 60_000 });

  const proposalValidation = page.getByTestId("qcms-acard-issues");
  await expect(proposalValidation).toContainText(
    `New question ${proposedId}. Accepting creates it as an unpublished draft`,
    { timeout: 30_000 },
  );
  await expect(proposalValidation).not.toContainText("Pin it, or change the reference");

  const previousSave = await savedStamp(page);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await waitForSaveAfter(page, previousSave);

  const validation = page.getByRole("region", { name: "Validation" });
  await expect(validation.getByTestId("qcms-issue-summary")).toContainText("1 issue", {
    timeout: 30_000,
  });
  await expect(validation).toContainText("can only pin a published version");
  await expect(validation).not.toContainText("does not resolve");

  await openStep(page, "About you");
  await expect(pinLabel(page, proposedId, 1)).toContainText("Preferred name");
  await expect(pinLabel(page, proposedId, 1)).toContainText("Unpublished version");

  await page.goto(`/questions/${proposedId}`);
  await expect(page.getByRole("heading", { name: proposedId })).toBeVisible({ timeout: 30_000 });
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await page.goto(`/forms/${newFormId}`);
  await openStep(page, "About you");
  await expect(pinLabel(page, proposedId, 1)).not.toContainText("Unpublished version", {
    timeout: 30_000,
  });
});
