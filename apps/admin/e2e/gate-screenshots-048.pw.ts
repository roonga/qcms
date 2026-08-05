import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { ADMIN_BASE_URL } from "./support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { createDraft, field } from "./support/questions.js";

/**
 * Capture the screenshot set for the task 048 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-048
 * ```
 *
 * ## The set: three states, two viewports, three modes
 *
 * What the Code Owner is being asked to look at is a **placeholder**, so the set is built
 * around the one comparison that shows it doing its job:
 *
 * 1. `messages-placeholders` - a short-text question carrying four constraints, with every
 *    message field empty. Each box shows the sentence a respondent would see today, with
 *    this question's own bounds interpolated ("at least 8 characters", not "{n}"). This is
 *    the frame that proves the fallback is legible as a default rather than as content.
 * 2. `messages-authored` - the same screen with an override typed into every field, so the
 *    two frames read side by side as "inherited" against "overridden". Typed and not saved:
 *    what is under review is the editor's rendering, and a saved document would make frame
 *    1 unreproducible.
 * 3. `boolean-labels` - a yes/no question's two label fields, each showing its lexicon
 *    default as a placeholder, plus its own required-message field.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule; the narrow frame is the one that
 * matters most here, because a placeholder is a full sentence inside a text input and a
 * sentence that clips at 390 is a default an author cannot read. All three modes, because a
 * placeholder's contrast against its own field is a per-mode question and the one thing
 * high contrast is most likely to get wrong.
 *
 * Everything else (hydration waiting, dev-chrome suppression, the 1.4.10 overflow refusal,
 * and Playwright's caret trap from issue #220) lives in `support/capture.ts`.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate048");
const capture = captureInto("docs/gates/048");

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** The short-text question whose message fields carry the first two frames. */
let messagesId = "";
/** The yes/no question whose label fields carry the third. */
let booleanId = "";

/** The overrides typed into frame 2, in the wording an insurer would actually use. */
const OVERRIDES = [
  { label: "Message when no answer is given", text: "We cannot find your cover without it." },
  { label: "Message when the answer is too short", text: "A policy number is 8 characters." },
  { label: "Message when the answer is too long", text: "A policy number is 12 characters." },
  {
    label: "Message when the answer does not match the pattern",
    text: "Two letters then six digits, as printed on your certificate.",
  },
] as const;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors the two questions the capture shows", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // Four constraints on one question, which is the densest the message panel gets: every
  // shortText key plus `required`, so the frame shows the whole list rather than a sample.
  await createDraft(page, `gate048-policy-${Date.now().toString(36)}`, "Short text");
  messagesId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(messagesId, "the created draft should own the URL").toMatch(/^q_/u);
  await setConstraints(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await createDraft(page, `gate048-at-fault-${Date.now().toString(36)}`, "Yes or no");
  booleanId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await requireAnAnswer(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(180_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    // FRAME 1: every message field empty, every placeholder showing this question's own
    // default. The assertion is part of the evidence: a frame of an empty box is worthless
    // unless the box is provably showing the interpolated default.
    await page.goto(`/questions/${messagesId}`);
    await expect(field(page, "Message when the answer is too short")).toHaveAttribute(
      "placeholder",
      "Answer must be at least 8 characters",
    );
    await capture(page, `messages-placeholders-${mode}`);

    // FRAME 2: the same screen, overridden. Not saved - see the header note.
    for (const override of OVERRIDES) {
      await fillStable(field(page, override.label), override.text);
    }
    await capture(page, `messages-authored-${mode}`);

    // FRAME 3: the boolean label pair, each on its lexicon default.
    await page.goto(`/questions/${booleanId}`);
    await expect(field(page, "Label for the affirmative choice")).toHaveAttribute(
      "placeholder",
      "Yes",
    );
    await expect(field(page, "Label for the negative choice")).toHaveAttribute("placeholder", "No");
    await capture(page, `boolean-labels-${mode}`);
  });
}

/** Set every constraint a short-text question can carry, so every message field appears. */
async function setConstraints(page: Page): Promise<void> {
  await requireAnAnswer(page);
  await fillStable(field(page, "Shortest answer"), "8");
  await fillStable(field(page, "Longest answer"), "12");
  await fillStable(field(page, "Pattern"), "^[A-Z]{2}[0-9]{6}$");
}

/**
 * Tick "an answer is required", which is what puts the `required` message field on screen.
 *
 * Clicked by its visible label rather than by the input: react-aria draws a decorative
 * indicator over the real checkbox and it intercepts pointer events. Same convention as the
 * preview ticks in `questions-lifecycle.pw.ts`.
 */
async function requireAnAnswer(page: Page): Promise<void> {
  await page.getByText("An answer is required", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "An answer is required" })).toBeChecked();
}
