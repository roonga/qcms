/**
 * Author-supplied validation messages (ADR-32) and boolean label overrides
 * (ADR-36) in the real browser, task 048.
 *
 * The unit layers pin the pieces (`lib/validation-message.test.ts` for the
 * per-constraint choice, the compiler's `author-messages.test.ts` for the
 * forwarding, the golden corpus for the bytes). What is only true here is that a
 * respondent actually SEES the author's wording where the author put it, that a
 * constraint the author left alone still shows the portal's default, and that an
 * overridden boolean label is what the accessibility tree announces while the wire
 * value underneath it has not moved.
 *
 * The 422s are REAL, driven through the kernel and the API on the seeded
 * `author-messages` form, so each test declares the expected non-2xx through the
 * browser gate's per-test hatch (`gates.ts`) before provoking it.
 */

import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";
import { blurActive } from "./support/kitchen-sink.js";

/** Accessible names the renderer emits for the `author-messages` form. */
const AM = {
  plate: "Registration plate",
  vin: "VIN",
  tows: "Do you tow a trailer?",
  garaged: "Is the vehicle garaged overnight?",
} as const;

/** The author's own wording, exactly as the fixtures carry it. */
const AUTHORED = {
  required: "Check the vehicle paperwork",
  minLength: "A plate is at least 3 characters",
  pattern: "Use capitals, digits and hyphens only, like ABC-123",
} as const;

/** The portal's default per-field message (`answer.invalid`), unchanged by 048. */
const DEFAULT_INVALID = "That answer is not valid.";

const ANSWERS_URL = /\/answers$/;

/** Start the `author-messages` flow anonymously and land on its only step. */
async function startAuthorMessages(page: Page, slug: string): Promise<void> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("textbox", { name: AM.plate })).toBeVisible();
  await waitForHydration(page);
}

/** Type a value the API will refuse into a text control and commit it on blur. */
async function commitRefused(page: Page, name: string, value: string): Promise<void> {
  const refused = page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 422,
  );
  await page.getByRole("textbox", { name }).fill(value);
  await blurActive(page);
  await refused;
}

test("a refused answer shows the author's wording for the constraint that failed", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 422, url: ANSWERS_URL });
  const { authorMessagesSlug } = readFixtures();
  await startAuthorMessages(page, authorMessagesSlug);

  // "AB" is 2 characters: minLength (3) is the first constraint the kernel
  // reports, and the author decorated it.
  await commitRefused(page, AM.plate, "AB");
  await expect(page.getByText(AUTHORED.minLength)).toBeVisible();
  await expect(page.getByText(DEFAULT_INVALID)).toBeHidden();

  // "abcdef" clears minLength and fails `pattern`, which the author also
  // decorated: a DIFFERENT constraint on the SAME question shows a different
  // message, which is what "per constraint" means at this layer.
  await commitRefused(page, AM.plate, "abcdef");
  await expect(page.getByText(AUTHORED.pattern)).toBeVisible();
  await expect(page.getByText(AUTHORED.minLength)).toBeHidden();
});

test("a constraint the author left alone still shows the portal default", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 422, url: ANSWERS_URL });
  const { authorMessagesSlug } = readFixtures();
  await startAuthorMessages(page, authorMessagesSlug);

  // 9 characters: `maxLength` (8) is the first constraint reported, and it is the
  // one constraint on this question the author did NOT decorate. So the fallback
  // is per constraint, not per question - the same field shows authored wording
  // for minLength and pattern above, and the default here.
  await commitRefused(page, AM.plate, "ABCDEFGHI");
  await expect(page.getByText(DEFAULT_INVALID)).toBeVisible();
  await expect(page.getByText(AUTHORED.pattern)).toBeHidden();
  await expect(page.getByText(AUTHORED.minLength)).toBeHidden();
});

test("an overridden boolean label is what the accessibility tree announces", async ({ page }) => {
  const { authorMessagesSlug } = readFixtures();
  await startAuthorMessages(page, authorMessagesSlug);

  // Both labels overridden (ADR-36): neither lexicon entry appears in this group.
  const tows = page.getByRole("radiogroup", { name: AM.tows });
  await expect(tows.getByRole("radio", { name: "Yes, I tow" })).toHaveCount(1);
  await expect(tows.getByRole("radio", { name: "No, I never tow" })).toHaveCount(1);
  await expect(tows.getByRole("radio", { name: "Yes", exact: true })).toHaveCount(0);
  await expect(tows.getByRole("radio", { name: "No", exact: true })).toHaveCount(0);

  // A MIXED pair: `yesLabel` overridden, `noLabel` still the compiler's
  // BOOLEAN_AFFIRMATION lexicon entry. Per-label fallback, not per-question.
  const garaged = page.getByRole("radiogroup", { name: AM.garaged });
  await expect(garaged.getByRole("radio", { name: "Garaged" })).toHaveCount(1);
  await expect(garaged.getByRole("radio", { name: "No", exact: true })).toHaveCount(1);
});

test("an override changes the label only: the wire values are untouched", async ({ page }) => {
  const { authorMessagesSlug } = readFixtures();
  await startAuthorMessages(page, authorMessagesSlug);

  // Presentation payload only (ADR-36): the two radios still carry the compiler's
  // BOOLEAN_TRUE_VALUE / BOOLEAN_FALSE_VALUE.
  const tows = page.getByRole("radiogroup", { name: AM.tows });
  await expect(tows.getByRole("radio", { name: "Yes, I tow" })).toHaveValue("true");
  await expect(tows.getByRole("radio", { name: "No, I never tow" })).toHaveValue("false");

  // And the answer the API accepts for the relabelled radio is still a boolean:
  // the post carries `true`, not the label text.
  const posted = page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 200,
  );
  await page.getByText("Yes, I tow", { exact: true }).click();
  const response = await posted;
  expect(response.request().postDataJSON()).toMatchObject({
    questionId: "q_am_tows",
    value: true,
  });
});
