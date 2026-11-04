import type { Locator, Page } from "@playwright/test";

import { expect } from "../../../portal/e2e/support/gates.js";

import { waitForHydration } from "./hydration.js";

export async function openPublishWizard(page: Page, formId: string): Promise<void> {
  await page.goto(`/forms/${formId}/publish`);
  await waitForHydration(page);
  await expect(page.getByTestId("qcms-publish-wizard")).toBeVisible();
}

// The decorative radio indicator intercepts input clicks; press the visible label instead.
export async function chooseSource(page: Page, label: string): Promise<void> {
  const source = page.getByTestId("qcms-publish-source");
  await source.getByText(label, { exact: true }).click();
  await expect(source.getByRole("radio", { name: label })).toBeChecked();
}

// The decorative checkbox indicator covers its input; click the label and assert the native checked state.
export async function chooseDestination(destinations: Locator, environment: string): Promise<void> {
  const row = destinations.locator(`div[data-environment="${environment}"]`);
  await expect(row).toHaveAttribute("data-eligible", "true");
  await row.getByText(environment, { exact: true }).click();
  await expect(
    destinations.getByRole("checkbox", { name: environment, exact: true }),
  ).toBeChecked();
}

export async function releaseThroughWizard(
  page: Page,
  input: { readonly formId: string; readonly version: number; readonly environment: string },
): Promise<void> {
  await openPublishWizard(page, input.formId);

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

// The wizard reports the refusal count; individual issues stay in the builder's validation work list.
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
  // Keep the navigable work list outside the live region so it is not announced as one flat interruption.
  const status = page.getByTestId("qcms-publish-status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("Nothing was published or released");
  await expect(status.getByTestId("qcms-publish-rejected")).toHaveCount(0);
}

export async function publishDraftThroughWizard(
  page: Page,
  input: {
    readonly formId: string;
    readonly version: number;
    readonly environment: string;
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
