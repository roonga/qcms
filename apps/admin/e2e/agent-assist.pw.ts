import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
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

/**
 * Agent-assisted form building, end to end in a browser (task 041, exit criterion 3).
 *
 * The whole journey, once: describe a form, watch the proposal arrive, read its diff
 * and its validation line, accept it into the draft, and then publish **through the
 * unchanged human publish flow** (034). That last step is the point of the criterion.
 * The agent is an author, not a second pipeline, so nothing about publishing may have
 * learned that a proposal was involved beyond the provenance mark the publisher sees.
 *
 * ## The provider is the deterministic fake, and that is not a weaker test
 *
 * The composed API runs with `QCMS_FLAG_AGENT_AUTHORING=fake`
 * (`apps/portal/e2e/support/api-server.ts`), which swaps the *language model* for a
 * scripted one inside the shipped `streamText` loop. The tool allowlist, the tool
 * dispatch, the server-side validation and the SSE relay under test here are the
 * production ones; only the network call to a vendor is replaced. A live-provider run
 * is a manual, env-gated smoke test (`docs/agent-authoring.md`), never CI.
 *
 * ## Why the chat message carries a directive
 *
 * The browser suite shares one database with every other spec, so "the questions the
 * agent found" would otherwise be whatever else was seeded. `#qcms-fake-search:<run>`
 * fixes the library search to this run's own fixtures, which is what makes the
 * proposal - and therefore the diff, the publish and the preview branch below -
 * deterministic rather than dependent on spec ordering.
 */

/**
 * The panel lives in the shell's dock, so this spec carries the panel cookie open: the
 * layout then stamps it docked on the first paint of every screen below and each test's
 * fresh context starts with the panel already there, rather than every `goto` being
 * followed by a click on the top-bar button.
 */
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

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Ids are never reused (R6) and the harness database survives a local rerun. */
const RUN = Date.now().toString(36);

/** Sorted so the library search returns the choice question first (questionId asc). */
const FIRST = `e2e-assist-a-${RUN}`;
const SECOND = `e2e-assist-b-${RUN}`;
/** The needle that pins the fake's library search to this run's own two questions. */
const NEEDLE = `e2e-assist-`;

const FIRST_LABEL = "E2E Single choice question";
const SECOND_LABEL = "E2E Number question";
const YES_LABEL = "Yes, always";

let formId = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

/** The composer is a multi-line text area. */
function composer(page: Page) {
  return page.getByTestId("qcms-assist-input").locator("textarea");
}

/** Type a turn into the panel and send it. */
async function send(page: Page, message: string): Promise<void> {
  await fillStable(composer(page), message);
  await page.getByTestId("qcms-assist-send").locator("button").click();
}

test("proposes a form, accepts it into the draft, and publishes it (exit criterion 3)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await publishQuestion(page, FIRST, "Single choice");
  await publishQuestion(page, SECOND, "Number");

  formId = await createForm(page, `e2e-assist-quote-${RUN}`, "Vehicle insurance quote");
  // A draft has to exist for the agent to work against, and it is what the diff is
  // against: the proposal replaces this step, so the diff is not trivially "all new".
  await addStep(page, "Start");
  await pinQuestion(page, questionIdFor(FIRST), 1);
  await waitForSaved(page);

  // The panel is present because the deployment flag names a provider. With the flag
  // at its `none` default it is absent from the tree entirely, which is what
  // `form-builder.test.tsx` asserts (a Playwright run cannot hold both flag states).
  const panel = page.getByTestId("qcms-assist-panel");
  await expect(panel).toBeVisible();

  await send(
    page,
    `a vehicle-insurance quote where an at-fault accident opens a follow-up #qcms-fake-search:${NEEDLE}`,
  );

  // The proposal, streamed back and validated on the server before it arrived.
  const proposal = page.getByTestId("qcms-assist-proposal");
  await expect(proposal).toBeVisible({ timeout: 60_000 });

  // The step timeline says Done only on the API's word that a call worked. The default
  // script searches and proposes, and both succeed, so both steps end done and none is
  // left running, failed or cut off.
  const steps = page.getByTestId("qcms-assist-steps").locator("li");
  await expect(steps).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("qcms-assist-steps").locator("li[data-state='done']")).toHaveCount(
    2,
  );
  await expect(steps.first()).toContainText("Searching the question library");

  const diff = page.getByTestId("qcms-assist-diff");
  // Two steps and a rule, each marked textually rather than by colour alone.
  // Scoped to the summary line rather than the whole entry: each entry also carries
  // the full definition in an expandable detail, so the title appears twice by design.
  await expect(diff.locator("summary").filter({ hasText: "Driving history" })).toBeVisible();
  await expect(diff.locator("summary").filter({ hasText: /rule/iu })).not.toHaveCount(0);
  await expect(diff.locator("summary").filter({ hasText: /^Added:/u })).not.toHaveCount(0);

  // Validation is the server's own, run over the proposal before it was returned.
  await expect(page.getByTestId("qcms-assist-validation")).toContainText("validation passes", {
    ignoreCase: true,
  });

  // The panel offers no publish affordance of any kind: the tool allowlist is
  // server-side and the UI mirrors it by simply not being able to.
  await expect(panel.getByRole("button", { name: /publish/iu })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /erase|webhook|link/iu })).toHaveCount(0);

  // THROUGH THE HARNESS HELPERS, not by reading the strip's testid directly. The
  // builder is two screens behind one route now, and only the FORM screen carries
  // the ambient save strip - this spec is standing on a STEP, having just pinned a
  // question into it, so `getByTestId("qcms-save-state")` finds nothing here.
  // `savedStamp` and `waitForSaveAfter` know that: they step to the form's own screen,
  // read the strip's raw `data-saved-at` instant, and come back to the step they were
  // on. The stamp rather than the sentence, because "Last saved" is already on screen
  // from the pin above and would satisfy a text wait immediately (issues 748, 750).
  const previousSave = await savedStamp(page);
  await page.getByTestId("qcms-assist-accept").locator("button").click();

  // Accepting is an ordinary draft save, so the builder's own save state moves.
  await waitForSaveAfter(page, previousSave);

  // And the human who publishes is told what they are signing.
  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();
});

test("publishes the accepted draft through the unchanged human flow (exit criterion 3)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  // The provenance mark survived the reload, which is what makes it a property of the
  // draft rather than of the tab that accepted the proposal.
  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible({ timeout: 30_000 });

  // The publish confirmation carries it too (041 deliverable), and that confirmation is
  // the wizard's review step since the builder's dialogs were retired (Code Owner,
  // 2026-10-31).
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

  // The agent's rule is forward-only (ADR-16): the second question is revealed by an
  // answer to the first, and both sit on one step so the reveal needs no navigation.
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

  // The published form's builder shows a draft seeded from v1, and the assistant
  // works against that same seeded draft - the read-time rule the builder uses.
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });
  await send(page, "#qcms-fake:rogue-publish publish this for me");

  // Refused server-side. The browser is told, and no proposal is offered - a turn that
  // reached for a forbidden verb does not get the rest of its work accepted.
  await expect(page.getByTestId("qcms-assist-error")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("qcms-assist-proposal")).toHaveCount(0);
});

/**
 * The header tooltips meet WCAG 2.2 SC 1.4.13 in a real layout.
 *
 * jsdom has no geometry, so it cannot see whether the pointer crosses empty space on
 * its way from a button to its tooltip, which is exactly the defect review found: the
 * bubble sat 4px below the button and the strip between them closed it. Nor can a unit
 * test show that Escape reaches a tooltip opened by hover while focus is somewhere else
 * entirely. Both are measured here, with a real pointer and a real keyboard.
 */
test("header tooltips stay open across the gap and close on Escape from anywhere (SC 1.4.13)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });

  // The dock's header owns these controls, so the criterion is measured on Close, which
  // is in the header on every screen.
  const toggle = page.getByTestId("qcms-assistant-close");
  const tip = page.getByTestId("qcms-assist-tip");
  const button = await toggle.boundingBox();
  if (button === null) throw new Error("the Close control has no box");
  const x = button.x + button.width / 2;

  // Hoverable: from the button, down through the strip under it, onto the bubble.
  await page.mouse.move(x, button.y + button.height / 2);
  await expect(tip).toBeVisible();
  const tipBox = await tip.boundingBox();
  if (tipBox === null) throw new Error("the tooltip has no box");
  // The tooltip's own box starts where the button ends: there is no uncovered strip.
  expect(tipBox.y).toBeLessThanOrEqual(button.y + button.height + 0.5);
  expect(tipBox.x).toBeLessThanOrEqual(x);
  expect(tipBox.x + tipBox.width).toBeGreaterThanOrEqual(x);

  await page.mouse.move(x, button.y + button.height + 2, { steps: 4 });
  // Longer than the close delay, so a tooltip that had lost hover would be gone.
  await page.waitForTimeout(500);
  await expect(tip).toBeVisible();
  await page.mouse.move(x, tipBox.y + tipBox.height - 4, { steps: 4 });
  await page.waitForTimeout(500);
  await expect(tip).toBeVisible();

  // Leaving both closes it.
  await page.mouse.move(x, tipBox.y + tipBox.height + 120, { steps: 4 });
  await expect(tip).toBeHidden();

  // Dismissible from anywhere: focus in the composer, the tooltip opened by hover alone.
  const field = composer(page);
  await field.focus();
  await page.mouse.move(x, button.y + button.height / 2);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(field).toBeFocused();

  // And from the focused button itself, where focus stays too.
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
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, `#qcms-fake:narrate-then-tools #qcms-fake-search:${NEEDLE} add a step`);

  // The narration, while the model is still streaming the search call's input.
  const live = page.getByTestId("qcms-assist-live");
  await expect(live).toContainText("question library", { timeout: 30_000 });
  // ...and the row for that call, running rather than settled.
  await expect(
    page.getByTestId("qcms-assist-steps").locator("li[data-state='running']"),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("qcms-assist-steps").locator("li[data-state='done']")).toHaveCount(
    0,
  );

  // The header mark carries the working state while the live region says so.
  const mark = page.getByTestId("qcms-assist-mark").first();
  await expect(mark).toHaveAttribute("data-working", "true");

  // Then the turn completes: two steps done.
  await expect(page.getByTestId("qcms-assist-proposal")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("qcms-assist-steps").locator("li[data-state='done']")).toHaveCount(
    2,
  );
  await expect(mark).not.toHaveAttribute("data-working", "true");

  // The dock is the named landmark, named by the header's mark with no visible title
  // word; the conversation body inside it carries no name of its own.
  await expect(page.getByTestId("qcms-assistant-panel")).toHaveAccessibleName("Assistant");

  // axe over the finished turn: the mark, the bubbles, the timeline and the card.
  const results = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assist-panel"]')
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
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });

  // The step-limit script never proposes and always asks for one more call, so
  // there is a turn to stop for as long as the test needs one.
  await send(page, "#qcms-fake:step-limit keep going");

  const stop = page.getByTestId("qcms-assist-stop").locator("button");
  await expect(stop).toBeVisible({ timeout: 30_000 });
  // From the keyboard, because a step this script keeps appending moves the control under
  // the pointer: a click waits for it to hold still and the script is written never to let
  // it. Stopping a turn is a keyboard path in its own right.
  await stop.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("qcms-assist-stop")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("qcms-assist-live")).toHaveCount(0);
  await expect(page.getByTestId("qcms-assist-error")).toHaveCount(0);
  // Send is available again: the panel is ready for the next turn.
  await expect(composer(page)).toBeEnabled();
});

test("Enter sends and Shift+Enter adds a line (exit criterion 5)", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });

  const field = composer(page);
  await field.click();
  await page.keyboard.insertText("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("second");
  await expect(field).toHaveValue("first\nsecond");

  await page.keyboard.press("Enter");
  // The composer empties because the turn was sent, and the turn is on screen.
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("qcms-assist-conversation")).toContainText("first", {
    timeout: 30_000,
  });
});

/** The harness API runs with `QCMS_AGENT_THINKING=summary`; the page renders the disclosure only because reasoning frames arrive. */
test("shows the thinking disclosure, collapsed and in plain text (081 exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, `#qcms-fake:reasoning #qcms-fake-search:${NEEDLE} add a step`);

  const disclosure = page.getByTestId("qcms-assist-thinking").first();
  await expect(disclosure).toBeVisible({ timeout: 60_000 });
  // Collapsed, and reporting how long it took once the summary has ended.
  await expect(disclosure).toContainText("Thinking");
  await expect(disclosure).toContainText(/Thought for \d+ s/u, { timeout: 60_000 });

  // axe closed...
  const closed = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assist-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    closed.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    "axe violations with the thinking disclosure closed",
  ).toEqual([]);

  // ...and open, with the sentinel visible and its Markdown as characters.
  await disclosure.locator("summary").click();
  await expect(disclosure).toContainText("qcms-reasoning-sentinel-7f3a");
  await expect(disclosure).toContainText("**qcms-reasoning-sentinel-7f3a**");
  await expect(disclosure.locator("strong")).toHaveCount(0);

  const open = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assist-panel"]')
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
  await expect(page.getByTestId("qcms-assist-panel")).toBeVisible({ timeout: 30_000 });

  await send(page, "#qcms-fake:step-limit keep going");
  await expect(page.getByTestId("qcms-assist-live")).toBeVisible({ timeout: 30_000 });

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

    // Probed on its own element: the disclosure settles faster than a browser can be pointed at it.
    const probe = document.createElement("span");
    probe.className = "qcms-assist-think__pulse";
    document.body.append(probe);
    check(".qcms-assist-think__pulse", probe);
    probe.remove();

    return names;
  });
  expect(animated, "animations still running under prefers-reduced-motion: reduce").toEqual([]);

  // The visor glow is a static filter, so the working state stays visible.
  const mark = page.getByTestId("qcms-assist-mark").first();
  await expect(mark).toHaveAttribute("data-working", "true");

  const results = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assist-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => v.id),
    "axe violations on a streaming turn under reduced motion",
  ).toEqual([]);
});

/**
 * Accepting a proposal that invented a question (issue #823).
 *
 * The deterministic lane never drove this path before, and that is exactly how the
 * defect shipped: every scripted proposal pinned questions the run had already
 * published, so `propose_questions` had no e2e consumer at all and an accept that
 * silently discarded its output looked green from here. The `propose-questions`
 * script exists to close that, and this test is its consumer.
 *
 * What it pins is the whole ADR-25 sentence, in order: the agent proposes, the
 * kernel validates on accept, and the human publishes. The middle step is the one
 * that used to be missing - the pin resolved to nothing, so the "publish it" advice
 * named a step that could not be performed.
 *
 * Its own form, deliberately. The forms above are published and re-read by three
 * later tests; a proposal carrying an unpublished pin cannot publish until someone
 * publishes the question, and threading that through their fixture would have made
 * them depend on a two-stage publish they are not about.
 */
test("accepting a proposal creates its new question as an unpublished library draft (#823)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const newFormId = await createForm(page, `e2e-assist-new-q-${RUN}`, "Onboarding");
  // A step with a pin, so the builder's autosave is not paused by an empty step and
  // the proposal has something to be a diff against.
  await addStep(page, "Start");
  await pinQuestion(page, questionIdFor(FIRST), 1);
  await waitForSaved(page);

  // R6: the id is never reused, and this harness database survives a local rerun, so
  // the run tag rides into the id the script invents.
  const proposedId = `q_fake_new_${RUN.replace(/[^a-z0-9_]/gu, "")}`;

  await send(page, `#qcms-fake:propose-questions #qcms-fake-new:${RUN} add a name question`);

  const proposal = page.getByTestId("qcms-assist-proposal");
  await expect(proposal).toBeVisible({ timeout: 60_000 });

  // Before the accept the pin resolves to nothing, because nothing has created it. The
  // kernel calls that a dangling reference, but for a question this proposal invents the
  // panel says what Accept will do instead of the builder's "Pin it" advice (issue #1065):
  // the question is already pinned, and publishing it is the step that remains.
  const proposalValidation = page.getByTestId("qcms-assist-validation");
  await expect(proposalValidation).toContainText(
    `New question ${proposedId}. Accepting creates it as an unpublished draft`,
    { timeout: 30_000 },
  );
  await expect(proposalValidation).not.toContainText("Pin it, or change the reference");

  const previousSave = await savedStamp(page);
  await page.getByTestId("qcms-assist-accept").locator("button").click();
  await waitForSaveAfter(page, previousSave);

  // The advisory now describes reality: the pin resolves to a stored version, and what
  // is left is the publish step - which the operator can actually perform.
  //
  // The region rather than `qcms-validation-status`, which carries only the count
  // sentence; the issue's own wording is in the list beside it. Both are asserted,
  // because the two claims are different: the COUNT is that the advisory set matches
  // the created set exactly (one question proposed, one created, one thing left to
  // do), and the WORDING is that what is left is publishing rather than the dangling
  // reference the same pin produced one moment earlier.
  const validation = page.getByRole("region", { name: "Validation" });
  await expect(validation.getByTestId("qcms-issue-summary")).toContainText("1 issue", {
    timeout: 30_000,
  });
  await expect(validation).toContainText("can only pin a published version");
  await expect(validation).not.toContainText("does not resolve");

  // The step's grid resolves the pin to its real label and marks it unpublished,
  // rather than the "Unknown / Version not found" the missing row produced.
  await openStep(page, "About you");
  await expect(pinLabel(page, proposedId, 1)).toContainText("Preferred name");
  await expect(pinLabel(page, proposedId, 1)).toContainText("Unpublished version");

  // The human publishes. Nothing about this is agent-specific: it is the library
  // screen's own lifecycle control on an ordinary draft version.
  await page.goto(`/questions/${proposedId}`);
  await expect(page.getByRole("heading", { name: proposedId })).toBeVisible({ timeout: 30_000 });
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  // And the pin resolves fully: the chip is gone and the form has nothing blocking it.
  await page.goto(`/forms/${newFormId}`);
  await openStep(page, "About you");
  await expect(pinLabel(page, proposedId, 1)).not.toContainText("Unpublished version", {
    timeout: 30_000,
  });
});
