import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";
import { environmentLabel } from "../lib/environment.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { presetEnvironment } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import {
  HELD_LANDING,
  prepareHeldPublish,
  type HeldPublishFixture,
} from "./support/held-publish.js";
import { suspendHold } from "./support/membership.js";

const PROD_SHOWN = environmentLabel("prod");

test.describe.configure({ mode: "serial" });

const VIEWER = uniqueAdminEmail("states103viewer");
const LANDING = /\/(questions|forms|me\/access)/u;
const FORM_ID = "frm_auto_quote";
const WORKSPACE_ID = "org_default_workspace";

let secret = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(VIEWER, { grants: ["forms.viewer"], owner: false });
  const page = await browser.newPage();
  secret = await enrollNewAdmin(page, VIEWER, LANDING);
  await page.close();
});

// The screen itself, measured at this width: never the denied recovery standing in for it.
async function open(page: Page, path: string, width: number, marker: string): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(path);
  await expect(page.getByTestId("qcms-denied-recovery"), `${path} is reached`).toHaveCount(0);
  await expect(page.getByTestId(marker), `${path} draws its own state`).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `${path} fits ${String(width)}px`,
  ).toBeLessThanOrEqual(width);
}

for (const width of [375, 320]) {
  test(`a View forms holder meets each unavailable act with its reason at ${String(width)}px`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signInWithTotp(page, VIEWER, secret, LANDING);
    await presetEnvironment(page, "prod");

    await open(page, "/forms", width, "qcms-forms-create");
    const create = page.getByTestId("qcms-forms-create").getByRole("button", { name: "New form" });
    await expect(create).toBeDisabled();
    await expect(create).toHaveAccessibleDescription(
      /^Creating a form needs Edit forms in .+\. Authors gives it\.$/u,
    );
    await expect(page.getByTestId("qcms-forms-read-only")).toHaveText(
      "You have View forms. Edit forms comes from Authors.",
    );
    await expect(page.getByTestId("qcms-form-read-only").first()).toHaveText("Read only");

    await open(page, `/forms/${FORM_ID}`, width, "qcms-form-read-only-notice");
    await expect(page.getByTestId("qcms-form-read-only-notice")).toContainText(
      "Read only: you have View forms in",
    );

    await open(page, `/operations/forms/${FORM_ID}/responses`, width, "qcms-responses-unavailable");
    await expect(page.getByTestId("qcms-responses-unavailable")).toContainText(
      `Responses are not available in ${PROD_SHOWN}`,
    );
    await expect(page.getByTestId("qcms-responses-unavailable")).toContainText(
      `View responses in ${PROD_SHOWN} comes from Response viewers.`,
    );

    await open(page, `/forms/${FORM_ID}/rules`, width, "qcms-form-read-only-notice");
    await expect(page.getByTestId("qcms-form-read-only-notice")).toContainText(
      "Read only: you have View forms in",
    );

    await open(
      page,
      `/operations/forms/${FORM_ID}/availability`,
      width,
      "qcms-form-availability-door",
    );
    const door = page.getByTestId("qcms-form-availability-door").getByRole("button");
    await expect(door).toBeDisabled();
    await expect(door).toHaveAccessibleDescription(`Needs Publish forms in ${PROD_SHOWN}.`);
  });
}

test("a suspended View responses says it waits for a re-confirmation", async ({ page }) => {
  test.setTimeout(300_000);
  const suspended = uniqueAdminEmail("states103suspended");
  await createTestAdmin(suspended, { grants: ["forms.viewer", "responses.viewer"], owner: false });
  await suspendHold(WORKSPACE_ID, "Every environment: responses.viewer", suspended, suspended);
  await enrollNewAdmin(page, suspended, LANDING);
  await presetEnvironment(page, "prod");

  await open(page, `/operations/forms/${FORM_ID}/responses`, 375, "qcms-responses-unavailable");
  const state = page.getByTestId("qcms-responses-unavailable");
  await expect(state).toContainText(
    "Your View responses in prod is suspended until a Workspace administrator re-confirms it.",
  );
  await expect(state.getByRole("link", { name: "My access" })).toHaveAttribute(
    "href",
    "/me/access",
  );
});

test("a workspace holding only a suspended place says so on My access", async ({ page }) => {
  test.setTimeout(300_000);
  const held = uniqueAdminEmail("states103onlysuspended");
  await createTestAdmin(held, { grants: ["responses.viewer"], owner: false });
  await suspendHold(WORKSPACE_ID, "Every environment: responses.viewer", held, held);
  await enrollNewAdmin(page, held, LANDING);

  await open(page, "/me/access", 375, "qcms-my-access-suspended");
  await expect(page.getByTestId("qcms-my-access-suspended")).toContainText(
    "Every environment: responses.viewer",
  );
  await expect(page.getByTestId("qcms-my-access-workspace")).toContainText("Suspended");
});

test.describe("a held draft publish to prod", () => {
  let fixture: HeldPublishFixture;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    fixture = await prepareHeldPublish(browser, "states103held");
  });

  for (const width of [375, 320]) {
    test(`shows the requester it pending, with no Approve, at ${String(width)}px`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await signInWithTotp(page, fixture.requester.email, fixture.requester.secret, HELD_LANDING);
      await presetEnvironment(page, "prod");
      await open(page, `/forms/${fixture.formId}/publish`, width, "qcms-held-publish");
      const row = page.getByTestId("qcms-held-publish");
      await expect(row).toHaveAttribute("data-viewer", "requester");
      await expect(row).toContainText("Waiting for an Approver");
      await expect(row).toContainText("Nothing is frozen until it is approved.");
      await expect(page.getByRole("button", { name: "Approve and publish" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    });

    test(`shows the approver the bound draft at ${String(width)}px`, async ({ page }) => {
      test.setTimeout(300_000);
      await signInWithTotp(page, fixture.approver.email, fixture.approver.secret, HELD_LANDING);
      await presetEnvironment(page, "prod");
      await open(page, `/forms/${fixture.formId}/publish`, width, "qcms-held-publish");
      await expect(page.getByTestId("qcms-held-publish")).toHaveAttribute(
        "data-viewer",
        "approver",
      );
      await expect(page.getByTestId("qcms-held-publish-summary")).toContainText(
        /^Patient intake, \d+ questions?, requested /u,
      );
      await expect(page.getByRole("button", { name: "Approve and publish" })).toBeEnabled();
    });
  }

  test("keeps the outcome once the decided request leaves the list", async ({ page }) => {
    test.setTimeout(300_000);
    await signInWithTotp(page, fixture.approver.email, fixture.approver.secret, HELD_LANDING);
    await presetEnvironment(page, "prod");
    await page.goto(`/forms/${fixture.formId}/publish`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId("qcms-held-publish-outcome")).toHaveText(
      "Rejected. Nothing was frozen or published.",
    );
    await expect(page.getByTestId("qcms-held-publish")).toHaveCount(0);
    await expect(page.getByTestId("qcms-held-publish-outcome")).toHaveText(
      "Rejected. Nothing was frozen or published.",
    );
  });
});

test("the route behind a hidden control still answers denied", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, VIEWER, secret, LANDING);
  await presetEnvironment(page, "prod");

  await page.goto(`/operations/forms/${FORM_ID}/responses`);
  await expect(page.getByTestId("qcms-responses-unavailable")).toBeVisible();
  await expect(page.getByRole("link", { name: /export/iu })).toHaveCount(0);

  const exported = await page.request.get(`/operations/forms/${FORM_ID}/export?format=csv`);
  expect(exported.status()).toBe(403);
});
