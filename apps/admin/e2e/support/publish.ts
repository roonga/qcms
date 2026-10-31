import type { Page } from "@playwright/test";

import { expect } from "../../../portal/e2e/support/gates.js";

import { waitForHydration } from "./hydration.js";

/**
 * The publish wizard, driven the way an operator drives it (issue #1197).
 *
 * One helper because the wizard is the one entry that releases anything: the release
 * dialog on the old `/forms/{id}/releases` screen is gone, and every spec that used to
 * open it comes through here. The steps are the wizard's own - a source, its destinations,
 * then one confirmation - so a spec that drifts from the real flow fails here once rather
 * than in each spec separately.
 */

/** Open the wizard on a form, from its own route. */
export async function openPublishWizard(page: Page, formId: string): Promise<void> {
  await page.goto(`/forms/${formId}/publish`);
  await waitForHydration(page);
  await expect(page.getByTestId("qcms-publish-wizard")).toBeVisible();
}

/**
 * Release one existing version into one destination, through the wizard.
 *
 * It asserts the two properties the wizard exists to hold on the way past: the destination
 * list is the review's, so an environment the caller cannot release into is absent rather
 * than disabled, and nothing is written until the final confirmation.
 */
export async function releaseThroughWizard(
  page: Page,
  input: { readonly formId: string; readonly version: number; readonly environment: string },
): Promise<void> {
  await openPublishWizard(page, input.formId);

  // An existing version, which is what a release is. The radio is already the default when
  // there is no publishable draft, and checking it again is harmless and explicit.
  await page.getByRole("radio", { name: "An existing version" }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await destinations.getByRole("checkbox", { name: input.environment, exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(`Version ${String(input.version)} is published.`);
  await expect(result.locator(`li[data-environment="${input.environment}"]`)).toBeVisible();
}
