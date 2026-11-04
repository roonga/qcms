import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  confirm,
  createdLink,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083formslist");

const RUN = Date.now().toString(36);

const SCOPE = `fake-new-${RUN}`;
const LIBRARY = `/forms?q=${SCOPE}`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("confirms a create alone, listing the new form and linking to it", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.goto(LIBRARY);
  await openPanel(page);
  await expect(page.getByRole("rowheader")).toHaveCount(0);

  const before = await auditTally();
  await propose(page, "propose-form-create", `start a form here #qcms-fake-new:${RUN}`);
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);

  await expect(createdLink(page)).toHaveAttribute("href", /^\/forms\/frm_/u);
  await expectAxeClean(page, "done");

  await expect(page.getByRole("rowheader", { name: SCOPE })).toBeVisible({ timeout: 30_000 });
  expect(auditDelta(before, await auditTally())).toEqual({ "form.create": 1 });
});

test("creates nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(LIBRARY);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-form-create", `start another one #qcms-fake-new:${RUN}`);
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(page.getByRole("rowheader")).toHaveCount(1);
});

test("confirms two creates inside one plan", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(LIBRARY);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "plan-forms-create", `start two more #qcms-fake-new:${RUN}`);
  await expectWaitingStepStates(page, "Proposed");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");

  await expect(page.getByRole("rowheader", { name: `${SCOPE}-a` })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("rowheader", { name: `${SCOPE}-b` })).toBeVisible();
  expect(auditDelta(before, await auditTally())).toEqual({ "form.create": 2 });
});
