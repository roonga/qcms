import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  deadUrl,
  deactivateExistingWebhooks,
  openDeliverer,
  submitResponse,
} from "./support/ops.js";
import { fillDate } from "./support/questions.js";

/**
 * Screenshot evidence for issue 514's design gate: one table family, one empty state.
 *
 * `plan/admin-design-contracts.md` §2 and §3 replace three table treatments and two
 * empty-state treatments with one of each, so what a reviewer has to judge is whether
 * the NINE tables now read as one thing and whether every "nothing here" reads as one
 * thing. That is a comparison across screens, which is what this set is arranged for:
 * every table the app has, then every empty state that is reachable, each frame named
 * after the screen so a directory listing reads as the comparison.
 *
 * `docs/gates/pr-514/README.md` names the contract clause each frame carries.
 *
 * ## Which modes are shot, and why not all three everywhere
 *
 * The full set is shot in **light**, and two anchor frames - one populated table, one
 * empty panel - are shot again in **dark** and **high-contrast**. The reason it is not
 * three full passes is that this change is a comparison ACROSS screens rather than a
 * new surface: every colour it uses is an existing token (`--color-border` for the
 * dividers, `--color-border-strong` for the header underline and the panel's dashed
 * edge, `--color-surface` for the panel), all three mode layers already define them,
 * and the earlier gate sets (032, 034, 035) have signed off those same tokens on these
 * same screens. What is genuinely new per mode is the dashed 1.5px panel edge and the
 * 2px header underline, and the anchor frames carry both. Tripling a set this size to
 * re-photograph unchanged tints would cost about 25 minutes of gate time for no extra
 * judgement.
 *
 * ## What is deliberately not in the set
 *
 * **The unfiltered question-library and form-library empty panels.** Both need a
 * database with no questions and no forms in it, and the seeded fixture this harness
 * runs on has both. The FILTERED question-library panel below is the same component
 * with §3's filtered variant applied, and the webhook panel below carries the primary
 * CTA the unfiltered library panel would. `app/(shell)/empty-and-table-states.test.tsx`
 * pins the unfiltered markup structurally, which is the honest coverage for a state a
 * capture cannot reach.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. Skipped unless
 * `QCMS_ADMIN_CAPTURE_GATE=1`, because it writes into a committed directory.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-514
 * ```
 *
 * ## The answers in the response frames are fixture answers
 *
 * The browser table renders respondent data in production and these PNGs are committed
 * to a public repository. The rows are made by this spec through the real respondent
 * routes, out of the seeded insurance fixture's own questions and invented values, so
 * nothing that reaches a committed image resembles a real person's answer.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate514");
const capture = captureInto("docs/gates/pr-514");

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
/** A seeded form that never gets an endpoint, so its "no endpoint" state stays real. */
const EMPTY_FORM_ID = "frm_kitchen_sink";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";

async function useMode(page: Parameters<typeof capture>[0], mode: string): Promise<void> {
  await page
    .context()
    .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
  await signInWithTotp(page, EMAIL, totpSecret);
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the capture signs in with", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret.length, "the enrollment produced a TOTP secret").toBeGreaterThan(0);
});

test("captures the library and operations tables, and the reachable empty states", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await useMode(page, "light");

  // 1. The question library. A kit-rendered table wearing the family (§2), which is the
  //    frame that shows the vendored component and the hand-authored tables reading the
  //    same: same 44px row, same header underline, same dividers, no zebra.
  await page.goto("/questions");
  await expect(page.getByRole("table")).toBeVisible();
  await capture(page, "questions-table-light");

  // 2. §3's FILTERED empty panel: the heading swapped to this screen's "no matches"
  //    line, no explanatory sentence, and clear-filters as the CTA.
  await page.goto("/questions?q=zzzz-matches-nothing");
  await expect(page.getByTestId("qcms-questions-empty")).toBeVisible();
  await capture(page, "questions-filtered-empty-light");

  // 3. The form library, the second kit table.
  await page.goto("/forms");
  await expect(page.getByRole("table")).toBeVisible();
  await capture(page, "forms-table-light");

  // 4. §3's panel with NO CTA, on a screen with no creating action: the erasure log
  //    before anything has been erased. This is also the screen whose failed read used
  //    to print "Nothing has been erased." underneath its own error alert.
  await page.goto("/responses/erasures");
  await expect(page.getByTestId("qcms-erasures-empty")).toBeVisible();
  await capture(page, "erasures-empty-light");

  // 5. §3's panel WITH a primary CTA, on a screen that has a creating action.
  await page.goto(`/forms/${EMPTY_FORM_ID}/webhooks`);
  await expect(page.getByTestId("qcms-webhooks-empty")).toBeVisible();
  await capture(page, "webhooks-empty-light");

  const deliverer = openDeliverer();
  try {
    // 6. The response browser: the widest table in the app, and the one whose sixth
    //    column drops at `--bp-compact`. The 390 frame is where §2's compact-width
    //    clause is visible rather than asserted.
    const erasable = await submitResponse(SLUG, [
      [ACCIDENT, true],
      [COUNT, 3],
    ]);
    await submitResponse(SLUG, [[ACCIDENT, false]]);
    await page.goto(`/forms/${FORM_ID}/responses`);
    await expect(page.getByTestId("qcms-responses-table")).toBeVisible();
    await capture(page, "responses-table-light");

    // 7. §3's filtered variant again, on a different screen, so the reviewer can see the
    //    two filtered-empty treatments the app used to have are now the same one.
    await page.goto(`/forms/${FORM_ID}/responses?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByTestId("qcms-responses-empty")).toBeVisible();
    await capture(page, "responses-filtered-empty-light");

    // 8. The erasure log with a row in it, which is the third hand-authored table.
    await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
    await page.getByRole("button", { name: "Erase respondent data…" }).click();
    const erase = page.getByTestId("qcms-erase-dialog");
    await expect(erase).toBeVisible();
    await erase.getByRole("textbox", { name: /Type the session id/ }).fill(erasable);
    await page.getByRole("button", { name: "Erase permanently" }).click();
    await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
    await page.goto("/responses/erasures");
    await expect(page.getByTestId("qcms-erasures-table")).toBeVisible();
    await capture(page, "erasures-table-light");

    // 9. The endpoints table. The endpoint points at a dead port, which is what sets up
    //    the delivery and dead-letter frames below.
    await page.goto(`/forms/${FORM_ID}/webhooks`);
    await deactivateExistingWebhooks(page, FORM_ID);
    await page.getByRole("button", { name: "Add endpoint" }).click();
    const create = page.getByTestId("qcms-webhook-url-dialog");
    await create.getByRole("textbox", { name: "Endpoint URL" }).fill(await deadUrl());
    await create.getByRole("button", { name: "Create endpoint" }).click();
    await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "I have copied it" }).click();
    await expect(page.getByTestId("qcms-webhooks-table")).toBeVisible();
    await capture(page, "webhooks-table-light");

    // 10. The delivery dashboard, driven to a real failure record so the row is not an
    //     unattempted one.
    await submitResponse(SLUG, [[ACCIDENT, false]]);
    await deliverer.drive(11);
    await page.goto(`/forms/${FORM_ID}/webhooks`);
    await expect(page.getByTestId("qcms-deliveries-table")).toBeVisible();
    await capture(page, "deliveries-table-light");

    // 11. The dead-letter queue.
    await page.goto("/webhooks");
    await expect(page.getByTestId("qcms-dead-letters-table")).toBeVisible();
    await capture(page, "dead-letters-table-light");
  } finally {
    await deliverer.close();
  }
});

test("captures the version-history and secure-link tables", async ({ page }) => {
  test.setTimeout(600_000);
  await useMode(page, "light");

  // The seeded insurance form, which is already published - so it has a version history
  // without this spec authoring one, and links can be minted against it. Authoring a form
  // here instead would put the library picker's pin flow between this capture and its
  // subject, which is a lot of moving parts for two frames of a table. Nothing else in
  // this run mints on that form, and the harness database does not outlive the run.
  const ownedFormId = FORM_ID;

  // 12. The version history: the third kit table, and the one whose rows deliberately did
  //     nothing. It used to opt OUT of the hover affordance with `qcms-table--static`;
  //     the family made the affordance opt-in, and issue 570 removed the opt-in along
  //     with the last whole-row handler. Its rows now carry the view link that used to
  //     sit in a list beneath the table, so this capture no longer matches what ships.
  await page.goto(`/forms/${ownedFormId}/versions`);
  await expect(page.getByRole("table", { name: "Published versions" })).toBeVisible();
  await capture(page, "version-history-table-light");

  // 13. The link lifecycle table - the last of the nine, and the one the issue flagged
  //     as the likeliest bad fit for the card's shape. It is not: the one-time reveal is
  //     the minted-links panel, which is a list and not this table.
  //
  //     The seeded form may or may not already carry links depending on what ran before
  //     this in the same harness database, so the mint is conditional rather than
  //     assumed. Either way the frame's subject is the same table.
  //
  //     There is deliberately no `links-empty` frame here. It needs a published form with
  //     no links against it, which this database does not reliably offer, and §3's panel
  //     is already carried by four other frames in this set - including both of its
  //     variants and both its with-CTA and without-CTA shapes.
  await page.goto(`/forms/${ownedFormId}/links`);
  if ((await page.getByTestId("qcms-links-table").count()) === 0) {
    await page.getByRole("button", { name: "Mint links" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await fillDate(page, "Expires", "12312030");
    await page.getByRole("dialog").getByRole("button", { name: "Mint", exact: true }).click();
    await expect(page.getByTestId("qcms-minted-links")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("qcms-minted-links").getByRole("button", { name: "Done" }).click();
  }
  await expect(page.getByTestId("qcms-links-table")).toBeVisible();
  await capture(page, "links-table-light");
});

for (const mode of ["dark", "hc"] as const) {
  test(`captures the ${mode} anchor frames`, async ({ page }) => {
    test.setTimeout(300_000);
    await useMode(page, mode);

    // One populated table, for the divider, the header underline and the row rhythm.
    await page.goto("/questions");
    await expect(page.getByRole("table")).toBeVisible();
    await capture(page, `questions-table-${mode}`);

    // One empty panel, for the 1.5px dashed `--color-border-strong` edge on the surface
    // colour, which is the only genuinely new painted thing in this change.
    await page.goto(`/forms/${EMPTY_FORM_ID}/webhooks`);
    await expect(page.getByTestId("qcms-webhooks-empty")).toBeVisible();
    await capture(page, `webhooks-empty-${mode}`);
  });
}
