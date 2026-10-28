import type { Page } from "@playwright/test";

export function stepSubmit(page: Page) {
  return page
    .getByTestId("step-card")
    .locator('form button[type="submit"]:not([name="__qop"]):not([data-qcms-implicit-submit])');
}

/** Submit the step's native form and wait for the page the 303 lands on. */
export async function submitStep(page: Page): Promise<void> {
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await stepSubmit(page).click();
  await served;
}

export const NATIVE_DATE_BOX = {
  day: (name: string) => `input[name="__qdd__${name}"]`,
  month: (name: string) => `input[name="__qdm__${name}"]`,
  year: (name: string) => `input[name="__qdy__${name}"]`,
} as const;

export async function fillNativeDate(page: Page, name: string, iso: string): Promise<void> {
  const [year = "", month = "", day = ""] = iso === "" ? [] : iso.split("-");
  await page.locator(NATIVE_DATE_BOX.day(name)).fill(day);
  await page.locator(NATIVE_DATE_BOX.month(name)).fill(month);
  await page.locator(NATIVE_DATE_BOX.year(name)).fill(year);
}

/**
 * Start counting the whole-step POSTs this page makes, so "the browser blocked it"
 * is a counted fact rather than an absence observed for an arbitrary length of time.
 *
 * Scoped to the step route: anonymous entry is a native form POST of its own (issue
 * #579), so an unscoped counter starts at one.
 */
export function countStepPosts(page: Page): () => number {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/s\/ses_[^/]+\/step$/.test(new URL(request.url()).pathname)
    ) {
      posts.push(request.url());
    }
  });
  return () => posts.length;
}

export async function walkToCoverStep(page: Page, slug: string): Promise<void> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await page.locator('input[name="q_full_name"]').fill("Ada Lovelace");
  await fillNativeDate(page, "q_dob", "1990-05-17");
  await submitStep(page);
  await page.getByText("No", { exact: true }).click();
  await page.getByText("Breakdown", { exact: true }).click();
  await submitStep(page);
}
