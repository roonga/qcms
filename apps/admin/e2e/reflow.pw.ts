import { setScreenEnvironment } from "./support/environment.js";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

const EMAIL = uniqueAdminEmail("reflow616");

const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const QUESTION_ID = "q_at_fault_accident";

const COUNT_ID = "q_accident_count";

const WORKSPACE_ID = "org_default_workspace";

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

// Parallel slots render alongside an owning page and are measured with that page, not as separate routes.
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

function livePath(pattern: string, sessionId: string): string {
  const fills: Record<string, string> = {
    "[formId]": FORM_ID,
    "[questionId]": QUESTION_ID,
    "[sessionId]": sessionId,
    "[version]": "1",

    "[workspaceId]": WORKSPACE_ID,
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

let totpSecret = "";
let sessionId = "";

// Measure the document scrollport; overflow inside a table's own scroll container is allowed.
async function documentWidth(page: Page, path: string, width: number): Promise<number> {
  await page.setViewportSize({ width, height: 900 });
  await setScreenEnvironment(page, path);
  await page.goto(path);
  await expect(page.locator("main#main-content"), `${path} renders the shell`).toHaveCount(1);
  return page.evaluate(() => document.documentElement.scrollWidth);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);

  sessionId = await submitResponse(SLUG, [
    [QUESTION_ID, true],
    [COUNT_ID, 3],
  ]);
  await page.close();
});

async function sweep(page: Page, width: number): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  const patterns = routePatternsUnder(SHELL, "");
  expect(patterns.length, "the shell route tree was read").toBeGreaterThan(10);
  for (const pattern of patterns) {
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
