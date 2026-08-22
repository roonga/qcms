import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin } from "./support/flow.js";

/**
 * Screenshot evidence for issue 558's design gate.
 *
 * Issue 558 replaces one global content cap with a per-route one: five screens get more
 * width, two get less, nine keep what they had. So the interesting frame is never a single
 * screen, it is a screen next to itself, and the set under `before/` is this same spec run
 * against the parent state - `app/(shell)/layout.tsx` and `app/globals.css` restored, and
 * `lib/measure.ts` / `components/measured-main.tsx` absent - so that every pair differs
 * only in the cap.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-558.pw.ts
 * ```
 *
 * ## Why every screen is shot, not just the seven that move
 *
 * The acceptance criterion that is easiest to wave through is "nine screens render
 * byte-identically", and a reviewer cannot check that by looking: two identical PNGs look
 * the same as two nearly-identical ones. So the whole set is captured at both widths and
 * the evidence for the nine is the sha256 table in `docs/gates/pr-558/byte-identity.txt`,
 * where identical means identical bytes. The frames a human is asked to LOOK at are the
 * seven that changed, which is why those are the pairs committed beside this run.
 *
 * ## Why no response is created
 *
 * Everything here is captured off the seeded fixture and nothing else, because the two
 * runs are minutes apart and a byte comparison only means something if the content is the
 * same in both. A submitted response would put a run-generated session id and a
 * minute-resolution stamp into three of the frames and make their pairs differ for a
 * reason that has nothing to do with a width cap. `/forms/[formId]/responses/[sessionId]`
 * is therefore absent from this sweep for the same reason and is covered by the measured
 * proof in `measure.pw.ts`, which does create one; every other screen's seeded content is
 * either fixed or formatted to the day.
 *
 * ## Why each frame starts from a fresh load at its own width
 *
 * `captureInto` resizes a live page between frames. The builder's rules pane sits inside a
 * `container-type: inline-size` context whose `@container` rule resolves on the layout
 * after the resize rather than during it, so a frame taken in that gap paints the pane at
 * the width it had a frame ago (issue 557 measured this, and issue 575 hit it again). A
 * gate whose whole argument is a width comparison cannot afford that, so every frame here
 * is its own navigation at its own viewport.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-558";
const EMAIL = uniqueAdminEmail("gate558");

/** The seeded insurance fixture: published v1, four secure links, no webhook endpoint. */
const FORM_ID = "frm_auto_quote";
const QUESTION_ID = "q_at_fault_accident";

/** The Code Owner's standing pair. The cap only bites at the wider one. */
const WIDTHS = [390, 1280] as const;

/** One frame: the file name, the path to open, and the cap issue 558 gives that route. */
type Frame = { readonly name: string; readonly path: string; readonly cap: string };

/**
 * Fifteen of the sixteen authenticated screens, in route order.
 *
 * `cap` is recorded here so the README beside the frames can name the clause each one
 * satisfies without a second list to keep in step.
 */
const FRAMES: readonly Frame[] = [
  { name: "forms", path: "/forms", cap: "unchanged" },
  { name: "form-builder", path: `/forms/${FORM_ID}`, cap: "wide" },
  { name: "form-links", path: `/forms/${FORM_ID}/links`, cap: "wide" },
  { name: "form-preview", path: `/forms/${FORM_ID}/preview`, cap: "narrow" },
  { name: "form-responses", path: `/forms/${FORM_ID}/responses`, cap: "unchanged" },
  { name: "form-versions", path: `/forms/${FORM_ID}/versions`, cap: "wide" },
  { name: "version-detail", path: `/forms/${FORM_ID}/versions/1`, cap: "narrow" },
  { name: "form-webhooks", path: `/forms/${FORM_ID}/webhooks`, cap: "wide" },
  { name: "questions", path: "/questions", cap: "unchanged" },
  { name: "question-detail", path: `/questions/${QUESTION_ID}`, cap: "unchanged" },
  { name: "question-new", path: "/questions/new", cap: "unchanged" },
  { name: "responses", path: "/responses", cap: "unchanged" },
  { name: "erasures", path: "/responses/erasures", cap: "unchanged" },
  { name: "settings", path: "/settings", cap: "unchanged" },
  { name: "webhooks", path: "/webhooks", cap: "wide" },
];

/**
 * Shoot one screen at both widths, each from its own load.
 *
 * The overflow check is `captureInto`'s, restated because that helper owns its own width
 * list: a full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways
 * produces a file wider than the width in its own name and misdescribes itself to a
 * reviewer who cannot measure a PNG in a GitHub diff. It is soft here so one screen's
 * Reflow problem reports itself without costing the other fourteen pairs their evidence.
 */
/**
 * Blank the one string on these screens that cannot repeat between two runs.
 *
 * The suite mints its admin account per run (`uniqueAdminEmail`), and the shell footer
 * prints that address on every authenticated screen, with the Settings account card
 * printing it a second time. Those were the only pixels an unmasked sweep found varying:
 * every other frame paired byte for byte, and the two that did not were pixel-diffed down
 * to exactly this line of text.
 *
 * `visibility: hidden` rather than Playwright's `mask` option, and the difference matters
 * here. A mask is an overlay box positioned from the element's measured rectangle, and on
 * a `fullPage` capture of a tall document it landed about 80px below the footer it was
 * meant to cover: the frame then carried both an uncovered address and a grey bar over
 * nothing. Hiding the element instead is done by the same layout engine that placed it, so
 * it cannot be off by a pixel, and `visibility` keeps the box in flow so no geometry moves.
 *
 * Only leaf elements are touched, so this blanks the line that holds the address and never
 * a card that contains it.
 *
 * The wait below is load-bearing and the mutation must never be done without it, which is
 * why it lives in here rather than at the call site. `waitForHydration` proves that the
 * FIRST button carries a React fiber, which is React reaching the top of the tree, not the
 * bottom of it. The address this blanks sits in the shell FOOTER, the last node the shell
 * renders, so a mutation timed off that first button can land while React is still walking
 * down towards it. React then finds a `visibility: hidden` the server never sent, reports a
 * hydration mismatch, and the shared console gate correctly fails the run: the same desync
 * `hideDevChrome` documents for issue 220, arriving through a different door.
 *
 * It was latent while it went unnoticed. Issues 553, 584 and 585 landed between this gate's
 * first green and this re-shoot, and 584 alone put 251 lines into `globals.css`; the pages
 * got heavy enough that the gap between the first button and the footer stopped being
 * winnable, and the sweep failed on its very first screen. Waiting for the element that is
 * about to be mutated removes the race rather than timing around it.
 */
async function blankTheOperatorAddress(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const footer = document.querySelector("footer");
    if (footer === null) return false;
    return Object.keys(footer).some((key) => key.startsWith("__reactFiber$"));
  });
  await page.evaluate((address) => {
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element.children.length === 0 && element.textContent?.includes(address) === true) {
        element.style.visibility = "hidden";
      }
    }
  }, EMAIL);
}

async function captureFrame(page: Page, frame: Frame): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(frame.path);
    await expect(page.locator("main#main-content")).toHaveCount(1);
    await waitForHydration(page);
    await hideDevChrome(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect
      .soft(scrollWidth, `the ${frame.name} frame fits its ${String(width)}px viewport`)
      .toBeLessThanOrEqual(width);
    await blankTheOperatorAddress(page);
    await page.screenshot({
      path: `${OUT_DIR}/${frame.name}-${String(width)}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("558 captures every screen at 390 and 1280, for the width comparison", async ({ page }) => {
  test.setTimeout(600_000);
  await enrollNewAdmin(page, EMAIL);
  for (const frame of FRAMES) {
    await captureFrame(page, frame);
  }
});
