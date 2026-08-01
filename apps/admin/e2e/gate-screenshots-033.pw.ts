import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  pinQuestion,
  rule,
  toggleTarget,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft, optionIds } from "./support/questions.js";

/**
 * Capture the screenshot set for the task 033 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-033
 * ```
 *
 * ## The set: four states, two viewports, three modes
 *
 * The form library, the builder with steps and pins, the condition editor with a complete
 * rule, and the same rule with a backward target flagged. Twenty-four frames, which is the
 * smallest set that shows what a reviewer has to judge: the two-column builder layout at
 * 390px (where it stacks) as well as at 1280px, the pin rows carrying `questionId@version`,
 * the target picker's two labelled groups, and the two error surfaces side by side - the
 * instant inline warning and the engine's own issue rendered at the rule.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. The mode comes from the real
 * `qcms-app-mode` cookie rather than from poking the DOM: a screenshot that did not go
 * through the real mechanism is evidence of nothing. Everything else - hydration waits,
 * dev-chrome suppression, the caret fix issue #220 records - lives in `support/capture.ts`.
 *
 * The library is authored through the UI for the reason the 032 capture states: this suite
 * runs against a per-run Testcontainers Postgres, so nothing is seeded and a capture
 * against fixtures would be a picture of a screen no operator reaches.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate033");
const capture = captureInto("docs/gates/033");
const RUN = Date.now().toString(36);

/**
 * The captured questions' slugs, sized to what an author actually types.
 *
 * These used to be `gate-cover-level-${RUN}` with the full 8-character base36 timestamp,
 * minting 27-character question ids and a 29-character rule id. Nothing in the repo is that
 * long: `q_at_fault_accident` (19) and `q_accident_count` (16) are the canonical ids in
 * `docs/wireframes/admin-form-builder.md`. The extra characters were pure test scaffolding,
 * and they pushed the rule card past the 390px viewport, so six frames came out 434px wide
 * while their filenames said 390 (PR #245 review). Measured at a 390px viewport: 19/16-char
 * ids give a 390px document in all four captured states, the 27-char ids gave 435px.
 *
 * So the tail is trimmed to 5 characters, which keeps the ids at exactly the canonical
 * length (`q_cover_level_XXXXX` is 19, `rul_cover_level_XXXXX` is 21) while still making
 * each run unique: the e2e database persists between runs and R6 refuses a reused id. Five
 * base36 characters of the millisecond clock repeat about every 17 hours, and a collision
 * fails loudly with the R6 message rather than silently.
 *
 * A longer id overflowing is a real and separate finding, raised for the Code Owner rather
 * than fixed here: an author's id is unbounded, `overflow-wrap: anywhere` on
 * `.qcms-question-id` alone only takes 435px down to 403px (measured), and deciding how the
 * builder should render a very long id at a phone width is a design question, not a
 * review-fix. `captureInto` now refuses to shoot an overflowing frame either way, so the
 * evidence can no longer misdescribe itself while that is decided.
 */
const TAIL = RUN.slice(-5);
const COVER = `cover-level-${TAIL}`;
const NOTES = `claim-notes-${TAIL}`;

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** Read off the published question rather than guessed. */
let coverOption = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors the questions the captured form pins", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createDraft(page, COVER, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  coverOption = (await optionIds(page))[0] ?? "";
  expect(coverOption).toMatch(/^opt_/u);

  await createDraft(page, NOTES, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(300_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto("/forms");
    await capture(page, `form-library-${mode}`);

    // Same sizing argument as COVER/NOTES above: `frm_vehicle_ins_light_XXXXX` rather than a
    // full timestamp, so the library row and the builder header show a plausible id.
    await createForm(page, `vehicle-ins-${mode}-${TAIL}`, "Vehicle insurance");
    await addStep(page, "Driving history");
    await pinQuestion(page, questionIdFor(COVER), 1);
    await addStep(page, "Claim details");
    await pinQuestion(page, questionIdFor(NOTES), 1);
    await waitForSaved(page);
    await capture(page, `form-builder-${mode}`);

    const ruleId = await addRule(page);
    const scope = rule(page, ruleId);
    await chooseOption(scope, "Operator", "equals (the whole answer)");
    await chooseOption(scope, "Value", coverOption);
    await toggleTarget(page, ruleId, questionIdFor(NOTES), true);
    await waitForSaved(page);
    await capture(page, `condition-editor-${mode}`);

    // The state the whole ADR-16 argument is about: an ineligible target picked on purpose,
    // its instant inline flag, and the engine's own issue arriving at the same rule.
    await toggleTarget(page, ruleId, questionIdFor(COVER), true);
    await expect(page.getByTestId("qcms-backward-flag")).toBeVisible();
    await expect(scope.locator('[data-issue-code="RULE_BACKWARD_TARGET"]')).toBeVisible({
      timeout: 30_000,
    });
    await capture(page, `backward-target-${mode}`);
  });
}
