import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { presetEnvironment } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm, field } from "./support/forms.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { waitForHydration } from "./support/hydration.js";
import { openPublishWizard } from "./support/publish.js";

// The environment belongs to Operations. Authoring reads and writes one shared draft, so every
// authoring screen loads and edits the same way whichever environment is selected.

const EMAIL = uniqueAdminEmail("authenv");
const RUN = Date.now().toString(36);
/** Seeded with a draft, so the wizard's draft source is offered on its own merits. */
const SEEDED_FORM_ID = "frm_auto_quote";

let secret = "";
let formId = "";

test.beforeAll(async ({ browser }) => {
  await createTestAdmin(EMAIL);
  const page = await browser.newPage({ baseURL: ADMIN_BASE_URL });
  secret = await enrollNewAdmin(page, EMAIL);
  await presetEnvironment(page, "prod");
  formId = await createForm(page, `e2e-authenv-${RUN}`, "Authoring in prod");
  await page.close();
});

test("with prod selected, New form offers the form itself rather than a way out", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, secret);
  await presetEnvironment(page, "prod");

  await page.goto("/forms/new");
  await waitForHydration(page);

  await expect(page).toHaveURL(/\/forms\/new$/);
  await expect(field(page, "Slug")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create form", exact: true })).toBeVisible();
});

test("with prod selected, the builder, Rules and Preview load and stay put", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, secret);
  await presetEnvironment(page, "prod");

  await page.goto(`/forms/${formId}`);
  await waitForHydration(page);
  await expect(page, "the builder does not bounce").toHaveURL(new RegExp(`/forms/${formId}$`));
  await expect(page.getByTestId("qcms-published-form-review")).toHaveCount(0);
  const title = field(page, "Title");
  await expect(title).toBeVisible();
  await expect(title).toBeEditable();
  // The rail reads the draft, not a released definition, so it names what is being authored.
  await expect(page.locator("aside.qcms-rail")).toContainText("Authoring in prod");

  await page.goto(`/forms/${formId}/rules`);
  await waitForHydration(page);
  await expect(page, "Rules does not redirect to the builder").toHaveURL(
    new RegExp(`/forms/${formId}/rules$`),
  );
  await expect(page.getByRole("heading", { level: 1, name: "Rules" })).toBeVisible();

  await page.goto(`/forms/${formId}/preview`);
  await waitForHydration(page);
  await expect(page, "Preview does not redirect to the builder").toHaveURL(
    new RegExp(`/forms/${formId}/preview$`),
  );
  await expect(page.getByRole("heading", { level: 1, name: "Preview" })).toBeVisible();
});

test("with prod selected, the publish wizard still offers the shared draft", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, secret);
  await presetEnvironment(page, "prod");

  await openPublishWizard(page, SEEDED_FORM_ID);
  const source = page.getByTestId("qcms-publish-source");
  await expect(source).toBeVisible();
  await expect(source.getByRole("radio", { name: /shared draft/u })).toBeEnabled();
});
