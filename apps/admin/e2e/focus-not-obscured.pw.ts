import type { ElementHandle, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { fillStable, enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  field,
  issue,
  issueSummary,
  pinQuestion,
  pinQuestions,
  waitForSaved,
} from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";
import { TOPBAR_SELECTOR } from "../lib/topbar.js";

// The sticky bar wraps at narrow widths; reserve its measured height rather than a single-row token.
// Check both geometry and centre-point hit testing after scrolling: axe at rest cannot detect this overlap.

const EMAIL = uniqueAdminEmail("obscured1011");

const FORM_ID = "frm_auto_quote";

let totpSecret = "";

const NARROW = { width: 390, height: 844 } as const;

const WIDE = { width: 1440, height: 900 } as const;

const WIDE_SHORT = { width: 1440, height: 600 } as const;

// Use distinct published question ids; a second version of one id introduces a duplicate-question issue.
const LIBRARY_PINS = [
  { questionId: "q_full_name", version: 1 },
  { questionId: "q_dob", version: 1 },
  { questionId: "q_optional_cover", version: 1 },
  { questionId: "q_extra_detail", version: 1 },
  { questionId: "q_coverage_level", version: 1 },
  { questionId: "q_annual_km", version: 1 },
  { questionId: "q_body_type", version: 1 },
  { questionId: "q_overnight_parking", version: 1 },
  { questionId: "q_accident_count", version: 1 },
] as const;

interface Landing {
  readonly barBottom: number;
  readonly barHeight: number;
  readonly controlTop: number;
  readonly controlBottom: number;
  readonly focused: boolean;
  readonly hitIsControl: boolean;
  readonly scrollPadding: number;
  readonly describe: string;
}

async function landingOf(handle: ElementHandle<HTMLElement | SVGElement>): Promise<Landing> {
  return handle.evaluate((element, selector) => {
    const bar = document.querySelector(selector);
    if (bar === null) throw new Error("the shell's top bar must be on screen");
    const barRect = bar.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + rect.height / 2),
    );

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.blockSize = getComputedStyle(document.documentElement).scrollPaddingTop;
    document.documentElement.append(probe);
    const scrollPadding = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      barBottom: barRect.bottom,
      barHeight: barRect.height,
      controlTop: rect.top,
      controlBottom: rect.bottom,
      focused: document.activeElement === element,
      hitIsControl: hit !== null && (element === hit || element.contains(hit)),
      scrollPadding,
      describe: `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`,
    };
  }, TOPBAR_SELECTOR);
}

// Keep only a candidate whose focus scrolls the page up; sticky or clamped controls can pass vacuously.
// Focus scrolls synchronously, so one evaluate can measure before and after without an intervening frame.
async function focusFromAboveTheFold(
  page: Page,
  where: string,
): Promise<ElementHandle<HTMLElement | SVGElement>> {
  const handle = await page.evaluateHandle((label: string) => {
    const main = document.querySelector("main#main-content");
    if (main === null) throw new Error(`${label}: the shell's main region must be on screen`);
    const candidates = [
      ...main.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
          'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (candidates.length === 0) throw new Error(`${label}: this screen has no focusable control`);

    const bottom = (): void => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    };
    bottom();
    if (window.scrollY <= 0) {
      throw new Error(
        `${label}: the screen does not overflow its viewport, so there is no scroll for a ` +
          `focus to come to rest in. Pick a longer screen.`,
      );
    }

    for (const element of candidates) {
      bottom();

      if (element.getBoundingClientRect().bottom >= 0) continue;
      const before = window.scrollY;
      element.focus();
      if (window.scrollY < before - 1) return element;
    }
    throw new Error(
      `${label}: scrolled to the bottom and no focusable control above the fold made the ` +
        `page scroll when it took focus, so this journey measures nothing.`,
    );
  }, where);
  return handle;
}

async function focusFromBelow(
  page: Page,
  path: string,
  size: { readonly width: number; readonly height: number },
): Promise<Landing> {
  await page.setViewportSize(size);
  await page.goto(path);
  await expect(page.locator("main#main-content"), `${path} renders the shell`).toHaveCount(1);

  // The shell publishes the measured bar height before the root hydration marker.
  await waitForHydration(page);
  return landingOf(await focusFromAboveTheFold(page, `${path} at ${String(size.width)}`));
}

function expectClearOfTheBar(landing: Landing, where: string): void {
  expect.soft(landing.focused, `${where}: the control took focus`).toBe(true);
  expect
    .soft(
      landing.controlTop,
      `${where}: ${landing.describe} came to rest at ${String(Math.round(landing.controlTop))}, ` +
        `and the ${String(Math.round(landing.barHeight))}px bar ends at ` +
        `${String(Math.round(landing.barBottom))} (scroll padding reserved ` +
        `${String(Math.round(landing.scrollPadding))}) - SC 2.4.11`,
    )

    .toBeGreaterThanOrEqual(landing.barBottom - 0.5);
  expect
    .soft(landing.hitIsControl, `${where}: the control's own centre is what is painted there`)
    .toBe(true);

  expect
    .soft(
      landing.scrollPadding,
      `${where}: the page reserves the bar's rendered height ` +
        `(${String(Math.round(landing.barHeight))}) when it scrolls something into view`,
    )
    .toBeGreaterThanOrEqual(landing.barHeight - 0.5);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

test("1011 focus reached from below clears the top bar on a form, at 390 and at 1440", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const path = `/forms/${FORM_ID}`;

  expectClearOfTheBar(await focusFromBelow(page, path, NARROW), `${path} at 390`);
  // The builder fits 1440x900, and a screen that cannot scroll tests nothing here.
  expectClearOfTheBar(await focusFromBelow(page, path, WIDE_SHORT), `${path} at 1440`);
});

test("1011 focus reached from below clears the top bar on the question library", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  expectClearOfTheBar(await focusFromBelow(page, "/questions", NARROW), "/questions at 390");
  expectClearOfTheBar(await focusFromBelow(page, "/questions", WIDE), "/questions at 1440");
});

test("1011 following a validation issue lands the pin row clear of the top bar at 390", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const run = Date.now().toString(36);

  await createDraft(page, `e2e-obscured-${run}`, "Single choice");
  const questionId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(questionId, "the created question owns the URL").toMatch(/^q_/u);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  const formId = await createForm(page, `e2e-obscured-${run}`, "Obscured focus");
  await addStep(page, "Details");

  await pinQuestion(page, questionId, 1);
  await pinQuestions(page, LIBRARY_PINS);
  await waitForSaved(page);

  await page.goto(`/questions/${questionId}`);
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");

  await page.setViewportSize(NARROW);
  await page.goto(`/forms/${formId}`);
  await waitForHydration(page);

  await fillStable(field(page, "Form title"), "Obscured focus, checked");
  await expect(issueSummary(page)).toContainText("would block a publish", { timeout: 30_000 });

  const link = issue(page, "DEPRECATED_PIN").filter({ hasText: questionId }).first();
  await expect(link).toBeVisible();

  await link.evaluate((element, selector) => {
    const bar = document.querySelector(selector);
    if (bar === null) throw new Error("the shell's top bar must be on screen");
    window.scrollBy(
      0,
      element.getBoundingClientRect().top - bar.getBoundingClientRect().bottom - 4,
    );
  }, TOPBAR_SELECTOR);
  await link.click();

  const row = page.locator(`#pin-${questionId}`);
  await expect(row).toBeFocused();
  const handle = await row.elementHandle();

  expect(handle, "the pin row the issue names is on screen").toBeTruthy();
  if (!handle) return;

  const landing = await landingOf(handle);
  // Soft screen switches clamp scrolling to the new height; judge the landing and reservation rather than scroll direction.
  expectClearOfTheBar(landing, "the pin row reached from its issue at 390");
});
