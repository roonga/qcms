import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * WCAG 2.2 AA SC 1.4.10 Reflow, for every authenticated screen (issue 616).
 *
 * ## Why this spec exists at all
 *
 * axe-core does not test 1.4.10. It cannot: the criterion is about whether a document
 * fits a 320px viewport, which is a measurement of a rendered layout rather than a
 * property of the markup. So an all-green axe run says nothing either way, and until
 * this spec there was nothing in CI that would have caught a screen scrolling
 * sideways. Issue 616's defect was found by a width spec that was looking at
 * something else entirely, and it had been shipping for as long as the screen had.
 *
 * The individual gate captures each carry an overflow guard of their own
 * (`support/capture.ts`, and the soft check in `gate-557.pw.ts` and `gate-558.pw.ts`),
 * but those only cover the screens some gate happened to photograph, only at the
 * widths that gate chose, and only when `QCMS_ADMIN_CAPTURE_GATE=1` is set. This one
 * runs in the ordinary browser suite, over every screen, at the width the criterion
 * actually names.
 *
 * ## Why 320 and not only 390
 *
 * **320 is the criterion.** SC 1.4.10 asks for content to be presentable without
 * horizontal scrolling at a width equivalent to 320 CSS pixels. 390 is the Code
 * Owner's standing gate width and is what every screenshot in this campaign is
 * reviewed at, so both are measured: a screen can pass at 390 and fail at 320, and
 * issue 616's own defect looked one pixel wide at 390 and 71 pixels wide at 320
 * because the overflow was a fixed minimum rather than a proportion of the viewport.
 *
 * `plan/admin-mobile-stance.md` says the same thing in this app's own terms: the
 * admin is not required to offer its full authoring experience on a phone, but
 * everything at narrow widths must be "free of overlap, clipping and horizontal
 * scroll", and wide content "scrolls inside its own container. The page body never
 * scrolls horizontally at any width."
 *
 * ## Why the screen list is read off the route tree
 *
 * The same reason `lib/measure.test.ts` reads it: a hand-written list of sixteen
 * paths silently stops covering the app the moment a seventeenth screen lands, and a
 * screen nobody measured is exactly how this class of defect survives. Here the
 * patterns come from `app/(shell)` and the dynamic segments are filled from the
 * seeded fixture, so a new route is swept the day it appears, with no list to update.
 *
 * Parallel slots (`@rail`) are skipped: a slot is not a route. It renders beside
 * `<main>` on a URL some page already owns, and that page's row already measures the
 * whole document, rail included.
 */

/**
 * Deliberately NOT `mode: "serial"`. The two widths are one question asked twice, and
 * a serial describe skips every later test once one fails, which would mean a screen
 * that overflows at 390 hides whether it also overflows at 320: exactly the fact
 * issue 616 turned on. The shared fixture is built in `beforeAll` instead, so each
 * width stands on its own and both verdicts are always reported.
 */

const EMAIL = uniqueAdminEmail("reflow616");

/** The seeded insurance fixture: published v1, four secure links, no webhook endpoint. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const QUESTION_ID = "q_at_fault_accident";
/** Answering the accident question `true` reveals this one, which is then required. */
const COUNT_ID = "q_accident_count";

/** The authenticated route group, read from disk rather than restated. */
const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/**
 * Every Next route pattern under the shell group.
 *
 * A directory contributes a pattern when it holds a `page.tsx`; route groups
 * contribute no segment; parallel slots are skipped whole. Kept deliberately
 * identical in shape to `lib/measure.test.ts`'s reader, so the two agree on what the
 * app's screens are.
 */
function routePatternsUnder(directory: string, prefix: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const patterns = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [prefix === "" ? "/" : prefix]
    : [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("@")) continue;
    const segment = entry.name.startsWith("(") ? prefix : `${prefix}/${entry.name}`;
    patterns.push(...routePatternsUnder(`${directory}/${entry.name}`, segment));
  }
  return patterns;
}

/**
 * A live path for a route pattern, from the seeded fixture.
 *
 * A pattern whose dynamic segment is not listed here fails loudly rather than being
 * skipped: an unswept screen is the thing this spec exists to prevent, so "I do not
 * know what to put in `[whatever]`" has to be a red test and not a quiet omission.
 */
function livePath(pattern: string, sessionId: string): string {
  const fills: Record<string, string> = {
    "[formId]": FORM_ID,
    "[questionId]": QUESTION_ID,
    "[sessionId]": sessionId,
    "[version]": "1",
  };
  return pattern
    .split("/")
    .map((segment) => {
      if (!segment.startsWith("[")) return segment;
      const fill = fills[segment];
      if (fill === undefined) {
        throw new Error(
          `reflow sweep has no fixture value for the route segment ${segment}. Add one ` +
            `beside the others, so the new screen is measured rather than skipped.`,
        );
      }
      return fill;
    })
    .join("/");
}

/** Built once by `beforeAll`: the enrolled account and the response the detail route needs. */
let totpSecret = "";
let sessionId = "";

/**
 * Open a screen at one width and report how far its document exceeds the viewport.
 *
 * `documentElement.scrollWidth` rather than a per-element measurement, because the
 * criterion is about the DOCUMENT: an element that overflows inside its own scroll
 * container is explicitly fine (that is what a wide data table is supposed to do),
 * and only what reaches the page's own scrollport is a Reflow failure.
 */
async function documentWidth(page: Page, path: string, width: number): Promise<number> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.locator("main#main-content"), `${path} renders the shell`).toHaveCount(1);
  return page.evaluate(() => document.documentElement.scrollWidth);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  // One submitted response, purely so the response-detail route has a subject to
  // render. A route that 404s measures Next's error page rather than a screen.
  sessionId = await submitResponse(SLUG, [
    [QUESTION_ID, true],
    [COUNT_ID, 3],
  ]);
  await page.close();
});

/** Sweep every screen at one width, reporting all of them rather than the first. */
async function sweep(page: Page, width: number): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  const patterns = routePatternsUnder(SHELL, "");
  expect(patterns.length, "the shell route tree was read").toBeGreaterThan(10);
  for (const pattern of patterns) {
    // Soft, so one sweep reports every screen's verdict rather than stopping at the
    // first one that overflows. The test still fails on any of them.
    expect
      .soft(
        await documentWidth(page, livePath(pattern, sessionId), width),
        `${pattern} fits ${String(width)} (SC 1.4.10)`,
      )
      .toBeLessThanOrEqual(width);
  }
}

test("616 every authenticated screen fits a 390px viewport", async ({ page }) => {
  test.setTimeout(300_000);
  await sweep(page, 390);
});

test("616 every authenticated screen fits the 320px viewport SC 1.4.10 names", async ({ page }) => {
  test.setTimeout(300_000);
  await sweep(page, 320);
});
