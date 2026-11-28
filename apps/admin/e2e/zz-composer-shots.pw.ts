import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";

const EMAIL = uniqueAdminEmail("shots");
const SLUG = `shots-${Date.now().toString(36)}`;
const SHOTS = process.env.QCMS_SHOT_DIR ?? "/tmp/qcms-agent-scratch/builder-composer/shots";
const WHEN = process.env.QCMS_SHOT_WHEN ?? "after";

const WORDY = `tell me about this form ${"and the step it starts with ".repeat(24)}`;

async function say(page: Page, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), message);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
}

async function measure(page: Page): Promise<string> {
  const pin = await page.getByTestId("qcms-builder-assistant").evaluate((body) => {
    const pane = body.parentElement;
    const composer = body.querySelector(".qcms-assistant__composer");
    const turns = body.querySelector(".qcms-assistant__turns");
    if (pane === null || composer === null || turns === null) throw new Error("no pane parts");
    const inset = Number.parseFloat(window.getComputedStyle(body).paddingBlockEnd);
    const foot = composer.getBoundingClientRect().bottom;
    const tall = (selector: string): number => {
      const node = document.querySelector(selector);
      return node === null ? -1 : Math.round(node.getBoundingClientRect().height);
    };
    return {
      composerGap: Math.round(body.getBoundingClientRect().bottom - inset - foot),
      bodyGap: Math.round(
        pane.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom,
      ),
      offScreenBy: Math.round(foot - window.innerHeight),
      transcriptScrolls: turns.scrollHeight - turns.clientHeight > 1,
      docScrollHeight: document.documentElement.scrollHeight,
      heights: {
        main: tall("#main-content"),
        builder: tall(".qcms-builder"),
        panes: tall(".qcms-builder__panes"),
        assistantPane: tall(".qcms-builder__pane--assistant"),
        previewPane: tall(".qcms-builder__pane--preview"),
        stage: tall(".qcms-builder-preview__stage"),
        paneBody: Math.round(body.getBoundingClientRect().height),
        turns: Math.round(turns.getBoundingClientRect().height),
      },
    };
  });
  return JSON.stringify(pin);
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("captures the builder composer", async ({ page }) => {
  test.setTimeout(900_000);
  await enrollNewAdmin(page, EMAIL);
  const formId = await createForm(page, SLUG, "Composer shots intake");

  for (const width of [1280, 800]) {
    const at = String(width);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/forms/${formId}/build`);
    await page.evaluate(() => {
      window.sessionStorage.clear();
    });
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();

    // eslint-disable-next-line no-console
    console.log(`SHOT ${WHEN} ${at} empty ${await measure(page)}`);
    await page.screenshot({ path: `${SHOTS}/${WHEN}-${at}-empty.png` });

    for (const turn of [1, 2, 3]) {
      await say(page, `${WORDY} ${String(turn)} #qcms-fake:no-proposal`);
      await expect(page.getByTestId("qcms-assistant-turns").getByRole("listitem")).toHaveCount(
        turn * 2,
        { timeout: 60_000 },
      );
    }

    // eslint-disable-next-line no-console
    console.log(`SHOT ${WHEN} ${at} long ${await measure(page)}`);
    await page.screenshot({ path: `${SHOTS}/${WHEN}-${at}-long.png` });
  }
});
