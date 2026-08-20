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
  field,
  pinQuestion,
  rule,
  toggleCheckbox,
  toggleTarget,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft, optionIds } from "./support/questions.js";
import {
  deactivateExistingWebhooks,
  deadUrl,
  openDeliverer,
  submitResponse,
} from "./support/ops.js";

/**
 * Screenshot evidence for issue 519's design gate.
 *
 * The change applies design-language element 3 in the three places the audit approves it,
 * and nowhere else: the builder's Settings and Test bench `<details>` panels get a heading
 * inside the `<summary>` plus a digest (`plan/admin-ux-audit.md` §4.3 and §3.7), and the
 * delivery dashboard's existing row trigger gets a digest (§3.8).
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium apps/admin/e2e/gate-519.pw.ts
 * ```
 *
 * Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`, because it writes into a committed
 * directory. The spec is named by PATH in that command on purpose: a bare name matches
 * every admin spec, and the flag un-skips every other capture spec with it.
 *
 * ## Every collapsible is shot twice, and that is the argument rather than a completeness
 * habit
 *
 * A digest is only visible while its disclosure is SHUT, and §3.7's rule - that a fact in
 * the digest must also exist inside the panel, because a collapsed `<details>` is gone
 * from the accessibility tree - is only visible while it is OPEN. One frame of either
 * state proves half a claim. So each of the three gets a collapsed frame and an expanded
 * one, and the pair is what a reviewer compares:
 *
 * - `builder-settings-*`: the digest states the challenge switch and the minimum-time
 *   value; expanded, the same checkbox and the same number field are underneath it.
 * - `builder-bench-*`: the digest states the loaded rule and how many questions it reads;
 *   expanded, that many answer controls are in the fieldset.
 * - `delivery-row-*`: the digest states status, failed attempts and latency; expanded, the
 *   `This delivery` list states all three in full. That list is also what puts an `h3`
 *   above the panel's `h4`s, closing issue #541's heading skip.
 *
 * ## What is deliberately NOT in the set
 *
 * Any other collapsible. §5.2 keeps one-time reveals non-collapsible and the audit's
 * "would not do at all" list rejects element 3 everywhere else for now, so there is no
 * fourth digest to photograph and the absence is the point.
 *
 * Each mode builds its own form and configures its own endpoint, for gate 035's reason:
 * three runs over one fixture would show the second and third modes a queue the first had
 * already worked. 390px and 1280px per the Code Owner's 2026-07-25 rule; the mode comes
 * from the real `qcms-app-mode` cookie. Hydration waits, dev-chrome suppression and the
 * reflow guard live in `support/capture.ts`.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate519");
const capture = captureInto("docs/gates/pr-519");

/** Five base36 characters of the clock, for gate 033's id-length reason. */
const TAIL = Date.now().toString(36).slice(-5);
const COVER = `cover-level-${TAIL}`;
const NOTES = `claim-notes-${TAIL}`;

/** The seeded insurance fixture, which is where deliveries can be made. */
const SLUG = "auto";
const OPS_FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";

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
  test.setTimeout(240_000);
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
    test.setTimeout(600_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    // --- the builder's two panels -------------------------------------------------
    await createForm(page, `vehicle-ins-${mode}-${TAIL}`, "Vehicle insurance");
    await addStep(page, "Driving history");
    await pinQuestion(page, questionIdFor(COVER), 1);
    await addStep(page, "Claim details");
    await pinQuestion(page, questionIdFor(NOTES), 1);

    // A rule, so the bench has something to load and its digest states a real rule id
    // rather than the empty-draft sentence.
    const ruleId = await addRule(page);
    const scope = rule(page, ruleId);
    await chooseOption(scope, "Operator", "equals (the whole answer)");
    await chooseOption(scope, "Value", coverOption);
    await toggleTarget(page, ruleId, questionIdFor(NOTES), true);
    await waitForSaved(page);

    // Both switches moved off their defaults, so the settings digest carries two stated
    // facts rather than one and a default.
    await toggleCheckbox(page, "Require a challenge before answering", true);
    await toggleCheckbox(page, "Use the deployment's minimum time", false);
    await field(page, "Minimum time before a submit is accepted (milliseconds)").fill("800");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByTestId("qcms-settings-state")).toHaveText("Settings saved.", {
      timeout: 30_000,
    });

    // The digest is BAKED into a committed PNG, so refuse to shoot a frame that does not
    // carry it: a capture of the old bare summary would send the Code Owner evidence of
    // the defect and call it the fix.
    const settingsHeading = page.getByRole("heading", { level: 2, name: "Form settings" });
    const settingsDigest = page.getByTestId("qcms-settings-digest");
    await expect(settingsHeading).toBeVisible();
    await expect(settingsDigest).toContainText("Challenge required");
    await expect(settingsDigest).toContainText("800");

    // Collapsed first: the digest is only visible in this state, and the panel ships open.
    await settingsHeading.click();
    await expect(
      page.getByRole("checkbox", { name: "Require a challenge before answering" }),
    ).toBeHidden();
    await capture(page, `builder-settings-collapsed-${mode}`);

    await settingsHeading.click();
    await expect(
      page.getByRole("checkbox", { name: "Require a challenge before answering" }),
    ).toBeChecked();
    await capture(page, `builder-settings-expanded-${mode}`);

    // The bench ships shut, so the collapsed frame is its first render.
    const benchHeading = page.getByRole("heading", { level: 2, name: "Rule test bench" });
    const benchDigest = page.getByTestId("qcms-bench-digest");
    await expect(benchHeading).toBeVisible();
    await expect(benchDigest).toContainText(ruleId);
    await expect(benchDigest).toContainText(/reads \d+ question/);
    await capture(page, `builder-bench-collapsed-${mode}`);

    await benchHeading.click();
    // §3.7 in the frame: the count the digest states is a count of controls in the panel.
    const reads = Number(/reads (\d+) question/.exec(await benchDigest.innerText())?.[1] ?? "-1");
    await expect(page.getByTestId("qcms-bench-reference")).toHaveCount(reads);
    await capture(page, `builder-bench-expanded-${mode}`);

    // --- the delivery dashboard's row trigger -------------------------------------
    const deliverer = openDeliverer();
    try {
      // Exactly one endpoint wide, so the fan-out this mode photographs is its own.
      await deactivateExistingWebhooks(page, OPS_FORM_ID);
      await page.getByRole("button", { name: "Add endpoint" }).click();
      const create = page.getByTestId("qcms-webhook-url-dialog");
      await create.getByRole("textbox", { name: "Endpoint URL" }).fill(await deadUrl());
      await create.getByRole("button", { name: "Create endpoint" }).click();
      await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "I have copied it" }).click();

      // A dead port and a driven retry budget: the digest is only worth reviewing on a row
      // that has a status, a failed-attempt count and a latency to state.
      await submitResponse(SLUG, [[ACCIDENT, false]]);
      await deliverer.drive(11);
      await page.goto(`/forms/${OPS_FORM_ID}/webhooks`);
      const deliveries = page.getByTestId("qcms-deliveries-table");
      await expect(deliveries).toBeVisible();

      const trigger = deliveries
        .getByRole("button", { name: /^Show request and response/ })
        .first();
      const digest = deliveries.getByTestId("qcms-delivery-digest").first();
      await expect(digest).toContainText("Dead-lettered");
      await expect(digest).toContainText("failed attempt");
      await capture(page, `delivery-row-collapsed-${mode}`);

      await trigger.click();
      const detail = page.getByTestId("qcms-delivery-detail");
      await expect(detail).toBeVisible();
      // The §3.7 half: all three digested facts, in full, inside the panel.
      await expect(detail.getByTestId("qcms-delivery-fact-status")).toHaveText("Dead-lettered");
      await expect(detail.getByTestId("qcms-delivery-fact-attempts")).not.toBeEmpty();
      await expect(detail.getByTestId("qcms-delivery-fact-latency")).not.toBeEmpty();
      // And the `h3` that closes issue #541's skip.
      await expect(detail.getByRole("heading", { level: 3, name: "This delivery" })).toBeVisible();
      await capture(page, `delivery-row-expanded-${mode}`);
    } finally {
      await deliverer.close();
    }
  });
}
