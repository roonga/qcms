/**
 * Shared respondent-flow driving helpers for the portal Playwright specs
 * (task 030). Centralized so the accessibility specs and the behavioral specs
 * drive the vehicle-insurance fixture the same way, and so the branch model
 * quirks (react-aria radio hit target, serialized answer posts, NumberField
 * per-keystroke commit) live in exactly one place.
 */

import { expect, type Page } from "@playwright/test";

/** The vehicle-insurance fixture's two branch questions (043 rename). */
export const ACCIDENT_LABEL = "Any at-fault accident in the last 3 years?";
export const COUNT_LABEL = "How many?";
export const FORM_HEADING = "Vehicle insurance quote";

/** Start anonymously at `/f/:slug`, click Start, land on the SSR flow page. */
export async function startAnonymousFlow(page: Page, slug: string): Promise<void> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
}

/**
 * Choose an at-fault-accident answer and wait for the answer to be recorded
 * server-side. The react-aria radio's real input sits under a decorative
 * indicator that intercepts pointer events, so click the option's visible label.
 * Answer posts are fire-and-forget, so wait for the `/answers` 200 before moving
 * on (else a follow-up answer races ahead and the API rejects it 409).
 */
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
