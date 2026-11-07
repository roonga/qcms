import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { waitForHydration } from "./support/hydration.js";
import { createDraft, openPanel } from "./support/questions.js";

const EMAIL = uniqueAdminEmail("roundcontrols");
const RUN = Date.now().toString(36);
const CHOICE_SLUG = `e2e-round-choice-${RUN}`;

const WIDE = 1280;
const NARROW = 390;

/* The shared classes plus the marks that are not buttons: one selector names every control the
   locked-circle rules cover. */
const ROUND = [
  ".qcms-round",
  ".qcms-iconbutton",
  ".qcms-radio__dot",
  ".qcms-opt-insert__plus",
  ".qcms-assist-steps__pulse",
  ".qcms-assist-think__pulse",
].join(", ");

const THEMES = [
  { name: "light", classes: ["light"] },
  { name: "dark", classes: ["dark"] },
  { name: "light high contrast", classes: ["light", "hc"] },
  { name: "dark high contrast", classes: ["dark", "hc"] },
] as const;

let secret = "";
let questionId = "";

test.beforeAll(async ({ browser }) => {
  await createTestAdmin(EMAIL);
  const page = await browser.newPage({ baseURL: ADMIN_BASE_URL });
  secret = await enrollNewAdmin(page, EMAIL);
  await createDraft(page, CHOICE_SLUG, "Single choice");
  questionId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.close();
});

// Only after hydration: a class the server did not render is a hydration mismatch.
async function wearTheme(page: Page, classes: readonly string[]): Promise<void> {
  await waitForHydration(page);
  await page.evaluate(
    (wanted) => {
      const root = document.documentElement;
      root.classList.remove("light", "dark", "hc");
      root.classList.add(...wanted);
    },
    [...classes],
  );
}

interface Measured {
  readonly what: string;
  readonly width: number;
  readonly height: number;
}

// Measure the box rather than the declared size: a block minimum can beat a correct `block-size`.
async function measureRound(page: Page): Promise<readonly Measured[]> {
  return page.evaluate((selector) => {
    const tenths = (value: number): number => Math.round(value * 10) / 10;
    return [...document.querySelectorAll(selector)]
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          what: `${node.tagName.toLowerCase()}.${node.getAttribute("class") ?? ""}`,
          width: tenths(box.width),
          height: tenths(box.height),
        };
      })
      .filter((measured) => measured.width > 0 && measured.height > 0);
  }, ROUND);
}

test("every round control measures square, at both widths in all four themes", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, secret);
  const screens = ["/questions", `/questions/${questionId}`, "/forms", "/me/access"];

  let seen = 0;
  for (const width of [WIDE, NARROW]) {
    await page.setViewportSize({ width, height: width === WIDE ? 900 : 844 });
    for (const screen of screens) {
      await page.goto(screen);
      if (screen.startsWith("/questions/q")) await openPanel(page, "options");
      for (const theme of THEMES) {
        await wearTheme(page, theme.classes);
        const measured = await measureRound(page);
        seen += measured.length;
        for (const one of measured) {
          expect
            .soft(one.width, `${screen} at ${String(width)} in ${theme.name}: ${one.what}`)
            .toBe(one.height);
        }
      }
    }
  }
  expect(seen, "no round control was measured, so nothing was asserted").toBeGreaterThan(0);
});
