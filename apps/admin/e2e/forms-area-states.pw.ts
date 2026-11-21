import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { presetEnvironment } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { suspendHold } from "./support/membership.js";

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
      "Responses are not available in prod",
    );
    await expect(page.getByTestId("qcms-responses-unavailable")).toContainText(
      "View responses in prod comes from Response viewers.",
    );

    await open(
      page,
      `/operations/forms/${FORM_ID}/availability`,
      width,
      "qcms-form-availability-unavailable",
    );
    await expect(page.getByTestId("qcms-form-availability-unavailable")).toHaveText(
      "Needs Publish forms in prod.",
    );
    await expect(
      page.getByTestId("qcms-form-availability").getByRole("button", { name: /^Close /u }),
    ).toBeDisabled();
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
