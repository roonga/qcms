import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createQuestionRailFixture, type QuestionRailFixture } from "./support/question-rail.js";

/**
 * Screenshot evidence for issue 650's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-650.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * The shape `gate-559.pw.ts` set: every frame is its own test named after the file it
 * writes, so `--grep detail-1024` re-shoots exactly that one. The fixture is built once in
 * `beforeAll` on a page of its own, which is what lets a single-frame run still have a
 * question to point at.
 *
 * ## What each frame is claiming
 *
 * The screen's design is `plan/admin-shell-poc/question-editor-poc.html`, so the clause each
 * frame satisfies is a thing that POC draws: the version group, its digest, the lifecycle
 * block pinned above the list, and the collapsed summary naming the selected version. Each
 * is recorded on the frame below and repeated in `docs/gates/pr-650/README.md`.
 *
 * ## Why 1023 and 1024 are both here
 *
 * `--bp-sidebar` is where a rail's behaviour turns, and a boundary is only shown by a pair:
 * one frame of a collapsed rail proves nothing about where it collapses.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-650";
const EMAIL = uniqueAdminEmail("gate650");
const RUN = Date.now().toString(36);

/** Set by `beforeAll`, which builds the fixture the frames are shot against. */
let totpSecret = "";
let fixture: QuestionRailFixture = {
  questionId: "",
  draftVersion: 0,
  publishedVersion: 0,
  deprecatedVersion: 0,
};

/** One frame: the width and height it is shot at, which version it selects, and whether the
    rail is left shut. */
interface Frame {
  readonly width: number;
  readonly height: number;
  readonly version?: number;
  readonly shut?: boolean;
}

async function capture(page: Page, name: string, frame: Frame): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: frame.width, height: frame.height });
  const query = frame.version === undefined ? "" : `?v=${String(frame.version)}`;
  await page.goto(`/questions/${fixture.questionId}${query}`);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByTestId("qcms-question-rail")).toBeVisible();
  await waitForHydration(page);
  await hideDevChrome(page);

  if (frame.shut === true) {
    await page.locator("summary.qcms-rail__summary").click();
    await expect(page.locator("details.qcms-rail__disclosure")).not.toHaveAttribute("open", "");
    // The click leaves a focus ring on the summary, which is chrome the reviewer is not
    // being asked about. Blurring is the whole of the cleanup: nothing else moved.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  }

  // A full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways produces a
  // file wider than the width in its own name and misdescribes itself to a reviewer who
  // cannot measure a PNG in a GitHub diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(frame.width)}px viewport`)
    .toBeLessThanOrEqual(frame.width);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  fixture = await createQuestionRailFixture(page, RUN);
  await page.close();
});

/** Below `--bp-sidebar` the rail is a disclosure, here shown open above the column. */
test("detail-390", async ({ page }) => {
  await capture(page, "detail-390", { width: 390, height: 900 });
});

/** Shut: the summary is the question id and the selected version, and nothing else. */
test("detail-390-shut", async ({ page }) => {
  await capture(page, "detail-390-shut", { width: 390, height: 900, shut: true });
});

/** One pixel below `--bp-sidebar`, still a disclosure and not a column. */
test("detail-1023", async ({ page }) => {
  await capture(page, "detail-1023", { width: 1023, height: 900 });
});

/** At `--bp-sidebar`: the 240px track, the digest, the pinned actions, the version list. */
test("detail-1024", async ({ page }) => {
  await capture(page, "detail-1024", { width: 1024, height: 900 });
});

/** The standing wide width, with the newest version selected and its Publish action. */
test("detail-1280", async ({ page }) => {
  await capture(page, "detail-1280", { width: 1280, height: 900 });
});

/** A published version selected: the frozen editor, and Deprecate in place of Publish. */
test("detail-1280-published", async ({ page }) => {
  await capture(page, "detail-1280-published", {
    width: 1280,
    height: 900,
    version: fixture.publishedVersion,
  });
});
