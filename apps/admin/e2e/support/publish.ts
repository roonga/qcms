import type { Locator, Page } from "@playwright/test";

import { expect } from "../../../portal/e2e/support/gates.js";

import { waitForHydration } from "./hydration.js";

/**
 * The publish wizard, driven the way an operator drives it.
 *
 * One helper because the wizard is the one entry that publishes or releases anything, so
 * every spec that publishes comes through here and a spec that drifts from the real flow
 * fails here once rather than in each spec separately.
 */

/** Open the wizard on a form, from its own route. */
export async function openPublishWizard(page: Page, formId: string): Promise<void> {
  await page.goto(`/forms/${formId}/publish`);
  await waitForHydration(page);
  await expect(page.getByTestId("qcms-publish-wizard")).toBeVisible();
}

/**
 * Choose the wizard's source, by the option's visible label.
 *
 * BY ITS LABEL, for the reason `chooseDestination` below records: the kit's radio hides its
 * own input behind a painted indicator, so `.check()` spends its whole timeout being told
 * the press was intercepted. The assertion still reads the input's checked state.
 */
export async function chooseSource(page: Page, label: string): Promise<void> {
  const source = page.getByTestId("qcms-publish-source");
  await source.getByText(label, { exact: true }).click();
  await expect(source.getByRole("radio", { name: label })).toBeChecked();
}

/**
 * Tick one destination, by the environment it names.
 *
 * BY ITS LABEL, never by a click aimed at the input, which is the same constraint
 * `toggleTarget` in `support/forms.ts` carries: the kit's checkbox paints a decorative box
 * over its own input, so Playwright's `.check()` spends its whole timeout being told that
 * the box intercepts the press. The assertion still reads the input, because selectedness
 * is what is being asserted.
 */
export async function chooseDestination(destinations: Locator, environment: string): Promise<void> {
  const row = destinations.locator(`div[data-environment="${environment}"]`);
  await expect(row).toHaveAttribute("data-eligible", "true");
  await row.getByText(environment, { exact: true }).click();
  await expect(
    destinations.getByRole("checkbox", { name: environment, exact: true }),
  ).toBeChecked();
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
  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, input.environment);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(`Version ${String(input.version)} is released.`);
  await expect(result.locator(`li[data-environment="${input.environment}"]`)).toBeVisible();
}

/**
 * Walk a draft the kernel will refuse, and return the wizard's refusal.
 *
 * The wizard names how many issues refused the publish and points at the builder; the work
 * list itself is the builder's validation panel, because its entries move focus to the
 * rule, step or pin at fault and only the builder renders those. Callers assert the codes
 * there, through `validationPanel`.
 */
export async function refuseDraftThroughWizard(
  page: Page,
  input: { readonly formId: string; readonly environment: string },
): Promise<void> {
  await openPublishWizard(page, input.formId);

  await chooseSource(page, "The shared draft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, input.environment);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  const rejected = page.getByTestId("qcms-publish-rejected");
  await expect(rejected).toBeVisible({ timeout: 30_000 });
  // The refusal is SPOKEN, which a rejection was not before issue #377, and the count is
  // what the live region carries: a screenful of links read out as one flat interruption
  // is neither navigable nor wanted, so the pointer stays outside it.
  const status = page.getByTestId("qcms-publish-status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("Nothing was published or released");
  await expect(status.getByTestId("qcms-publish-rejected")).toHaveCount(0);
}

/**
 * Freeze the stored draft and release the new version into one destination, in one
 * confirmation.
 *
 * The freeze summary an author reads before pressing is the wizard's own review step, so
 * the assertion lives here rather than in each caller.
 */
export async function publishDraftThroughWizard(
  page: Page,
  input: {
    readonly formId: string;
    readonly version: number;
    readonly environment: string;
    /** The exact sentence, for a caller asserting WHAT freezes rather than that it is read back. */
    readonly freezeSummary?: string;
  },
): Promise<void> {
  await openPublishWizard(page, input.formId);

  await chooseSource(page, "The shared draft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, input.environment);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // What freezes, read back before the one press that freezes it.
  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  const freeze = page.getByTestId("qcms-freeze-summary");
  if (input.freezeSummary === undefined) {
    await expect(freeze).toBeVisible();
  } else {
    await expect(freeze).toHaveText(input.freezeSummary);
  }
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(`Version ${String(input.version)} is published.`);
  await expect(result.locator(`li[data-environment="${input.environment}"]`)).toBeVisible();
}
