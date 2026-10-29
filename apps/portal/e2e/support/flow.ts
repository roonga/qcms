import { expect, type Page } from "@playwright/test";

import { waitForHydration } from "./hydration.js";

/** The vehicle-insurance fixture's two branch questions (043 rename). */
export const ACCIDENT_LABEL = "Any at-fault accident in the last 3 years?";
export const COUNT_LABEL = "How many?";
export const FORM_HEADING = "Vehicle insurance quote";

export async function startAnonymousFlow(page: Page, slug: string): Promise<void> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await waitForHydration(page);
}

export async function chooseAccident(page: Page, answer: "Yes" | "No"): Promise<void> {
  const recorded = page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 200,
  );
  await page.getByText(answer, { exact: true }).click();
  await recorded;
}

/**
 * Answer the follow-up count. The react-aria NumberField commits per keystroke,
 * so type key-by-key; the answer posts on blur, so move focus fully out of the
 * control by clicking a neutral heading.
 */
export async function answerCount(page: Page, value: string): Promise<void> {
  const count = page.getByRole("textbox", { name: /how many/i });
  await count.click();
  await count.pressSequentially(value);
  await page.getByRole("heading", { name: FORM_HEADING }).click();
}
