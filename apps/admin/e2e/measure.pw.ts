import { setScreenEnvironment } from "./support/environment.js";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("measure558");

const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const QUESTION_ID = "q_at_fault_accident";

const WORKSPACE_ID = "org_default_workspace";

const COUNT_ID = "q_accident_count";

const CAP_PX = {
  prose: 640,

  ops: 900,

  list: 1080,

  log: 1180,

  wide: 1600,
} as const;

type Cap = keyof typeof CAP_PX;

type Screen = { readonly path: string; readonly cap: Cap };

function screens(sessionId: string): readonly Screen[] {
  return [
    { path: "/forms", cap: "list" },
    { path: "/forms/new", cap: "prose" },
    { path: `/forms/${FORM_ID}`, cap: "wide" },
    { path: `/forms/${FORM_ID}/preview`, cap: "wide" },

    { path: `/forms/${FORM_ID}/rules`, cap: "wide" },
    { path: `/forms/${FORM_ID}/versions`, cap: "wide" },
    { path: `/forms/${FORM_ID}/versions/1`, cap: "wide" },

    { path: `/forms/${FORM_ID}/publish`, cap: "wide" },
    { path: "/questions", cap: "list" },
    { path: `/questions/${QUESTION_ID}`, cap: "wide" },
    { path: "/questions/new", cap: "prose" },

    { path: "/me/access", cap: "prose" },
    { path: "/operations", cap: "list" },
    { path: `/operations/forms/${FORM_ID}/erase`, cap: "prose" },
    { path: `/operations/forms/${FORM_ID}/intake`, cap: "prose" },
    { path: `/operations/forms/${FORM_ID}/links`, cap: "wide" },
    { path: `/operations/forms/${FORM_ID}/responses`, cap: "wide" },
    { path: `/operations/forms/${FORM_ID}/responses/${sessionId}`, cap: "wide" },
    { path: `/operations/forms/${FORM_ID}/webhooks`, cap: "wide" },
    { path: "/responses", cap: "list" },
    { path: "/responses/erasures", cap: "log" },
    { path: "/settings", cap: "prose" },
    { path: "/webhooks", cap: "wide" },

    { path: "/workspaces", cap: "ops" },
    { path: "/workspaces/all", cap: "list" },
    { path: `/workspaces/${WORKSPACE_ID}/members`, cap: "log" },
    { path: `/workspaces/${WORKSPACE_ID}/access-groups`, cap: "log" },
    { path: `/workspaces/${WORKSPACE_ID}/settings`, cap: "log" },
    { path: `/workspaces/${WORKSPACE_ID}/audit`, cap: "log" },
    { path: `/workspaces/${WORKSPACE_ID}/assistant-actions`, cap: "log" },
  ];
}

type Measured = {
  readonly cap: number;
  readonly width: number;
  readonly available: number;

  readonly left: number;
  readonly spaceStartsAt: number;
  readonly className: string;
};

async function measure(page: Page, path: string): Promise<Measured> {
  await setScreenEnvironment(page, path);
  await page.goto(path);
  const main = page.locator("main#main-content");
  await expect(main, `${path} renders the authenticated shell`).toHaveCount(1);
  return main.evaluate((element) => {
    const box = element.getBoundingClientRect();
    // Subtract the measured rail only when it sits beside the column; below the breakpoint it consumes height instead.
    const rail = document.querySelector(".qcms-rail")?.getBoundingClientRect();
    const besideTheColumn = rail !== undefined && rail.right <= box.left;
    return {
      cap: Number.parseFloat(getComputedStyle(element).maxWidth),
      width: box.width,
      available: document.documentElement.clientWidth - (besideTheColumn ? rail.width : 0),
      left: box.left,

      spaceStartsAt: besideTheColumn ? rail.right : 0,

      className: element.getAttribute("class") ?? "",
    };
  });
}

let totpSecret = "";
let sessionId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("657 caps each screen at the width its own POC draws, at 1280", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  sessionId = await submitResponse(SLUG, [
    [QUESTION_ID, true],
    [COUNT_ID, 3],
  ]);

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const screen of screens(sessionId)) {
    const measured = await measure(page, screen.path);

    expect
      .soft(measured.cap, `${screen.path} caps at the ${screen.cap} measure`)
      .toBe(CAP_PX[screen.cap]);
    expect
      .soft(measured.width, `${screen.path} fills the smaller of cap and viewport`)
      .toBe(Math.min(CAP_PX[screen.cap], measured.available));

    expect
      .soft(measured.left, `${screen.path} is left-anchored in the space it has`)
      .toBe(measured.spaceStartsAt);
    expect
      .soft(measured.className, `${screen.path} carries no centring utility`)
      .not.toContain("mx-auto");
  }
});

test("668 renders the three drawn inner elements at their drawn width, at 1280", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  const inner = [
    {
      path: `/questions/${QUESTION_ID}`,
      selector: ".qcms-editor-column",

      width: 720,
    },
    {
      path: `/forms/${FORM_ID}/versions/1`,
      selector: ".qcms-respondent-frame",

      width: 640,
    },
    {
      path: `/forms/${FORM_ID}/preview`,
      selector: ".qcms-respondent-frame",
      width: 640,
    },
  ] as const;

  for (const target of inner) {
    await setScreenEnvironment(page, target.path);
    await page.goto(target.path);
    const element = page.locator(target.selector);
    // Allow the server round trip: draft compilation and stored-version reads mount these panels after first paint.
    await expect(element, `${target.path} renders its drawn inner element`).toBeVisible({
      timeout: 60_000,
    });
    const box = await element.evaluate((node) => node.getBoundingClientRect().width);
    expect
      .soft(box, `${target.path} renders ${target.selector} at its drawn width`)
      .toBe(target.width);
  }

  await setScreenEnvironment(page, `/forms/${FORM_ID}/versions/1`);
  await page.goto(`/forms/${FORM_ID}/versions/1`);
  await expect(page.getByText("Respondent view, as stored at publish")).toBeVisible({
    timeout: 60_000,
  });
  await setScreenEnvironment(page, `/forms/${FORM_ID}/preview`);
  await page.goto(`/forms/${FORM_ID}/preview`);
  await expect(page.getByText("Respondent view", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
});

test("675 spends one section-padding token on the bar and the column alike, at 1280", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await setScreenEnvironment(page, "/webhooks");
  await page.goto("/webhooks");

  const pads = await page.evaluate(() => {
    const bar = document.querySelector("header > div");
    const main = document.querySelector("main#main-content");
    const pad = (element: Element | null, side: "Start" | "End") =>
      element === null
        ? Number.NaN
        : Number.parseFloat(getComputedStyle(element)[`paddingInline${side}`]);
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--admin-section-pad"),
      barStart: pad(bar, "Start"),
      barEnd: pad(bar, "End"),
      mainStart: pad(main, "Start"),
      mainEnd: pad(main, "End"),
    };
  });

  expect(pads.token.trim(), "the POC's token is the one declared").toBe("20px");
  expect(pads.barStart, "the bar's inline padding is the token").toBe(20);
  expect(pads.mainStart, "and so is the column's").toBe(20);
  expect(pads.barEnd, "on both sides of the bar").toBe(20);
  expect(pads.mainEnd, "and both sides of the column").toBe(20);
});

test("648 starts the bar and the content column one pad in, with the nav after the mark, at 1280", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  await setScreenEnvironment(page, "/questions");
  await page.goto("/questions");
  await expect(page.locator(".qcms-rail")).toHaveCount(1);

  const edges = await page.evaluate(() => {
    // Compare content edges: main's border box includes padding while the wordmark's box starts at its text.
    const contentLeft = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) return Number.NaN;
      const pad = Number.parseFloat(getComputedStyle(element).paddingInlineStart);
      return element.getBoundingClientRect().left + (Number.isNaN(pad) ? 0 : pad);
    };
    const header = document.querySelector("header");
    const trailing = document.querySelector(".qcms-topbar__tools");
    const nav = document.querySelector("header nav")?.parentElement?.getBoundingClientRect();
    return {
      wordmark: contentLeft(".qcms-topbar__toggle"),
      main: contentLeft("main#main-content"),
      wordmarkRight:
        document.querySelector(".qcms-wordmark")?.getBoundingClientRect().right ?? Number.NaN,
      navLeft: nav?.left ?? Number.NaN,
      navRight: nav?.right ?? Number.NaN,
      trailingLeft: trailing === null ? Number.NaN : trailing.getBoundingClientRect().left,

      barWidth: header === null ? Number.NaN : header.getBoundingClientRect().width,
      railRight: document.querySelector(".qcms-rail")?.getBoundingClientRect().right ?? Number.NaN,
      trailingRight: trailing === null ? Number.NaN : trailing.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
    };
  });

  expect(edges.barWidth, "the bar spans the viewport rather than being capped").toBe(
    edges.viewport,
  );

  expect(edges.main - edges.railRight, "the column's text starts one pad past the rail").toBe(
    edges.wordmark,
  );

  await expect(page.locator("footer"), "no page footer under the shell").toHaveCount(0);

  expect(
    edges.trailingRight,
    "and the trailing controls reach the far edge, so the bar is not a centred box",
  ).toBe(edges.viewport - edges.wordmark);

  expect(edges.navLeft, "the nav follows the mark on the same row").toBeGreaterThan(
    edges.wordmarkRight,
  );
  expect(edges.navRight, "and runs up to the trailing controls").toBeLessThanOrEqual(
    edges.trailingLeft,
  );
  expect(
    edges.trailingLeft - edges.navLeft,
    "so the nav spans the bar rather than sitting inside a capped box",
  ).toBeGreaterThan(edges.viewport / 2);
});

test("648 leaves the auth screens centred, because their own POC centres them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setScreenEnvironment(page, "/sign-in");
  await page.goto("/sign-in");

  const card = page.locator("main#main-content");
  await expect(card, "the sign-in screen renders").toHaveCount(1);
  const box = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: document.documentElement.clientWidth,
    };
  });

  expect(box.left, "the auth card is centred horizontally").toBeCloseTo(
    box.viewport - box.right,
    0,
  );
  expect(box.left, "and is genuinely inset rather than full width").toBeGreaterThan(0);
});

test("657 leaves every screen the same width at 390, because a cap is fluid below itself", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });

  const widths = new Map<string, number>();
  for (const screen of screens(sessionId)) {
    const measured = await measure(page, screen.path);
    expect.soft(measured.width, `${screen.path} is fluid at 390`).toBe(measured.available);
    widths.set(screen.path, measured.width);
  }
  expect(new Set(widths.values()).size, "all twenty-nine screens measure one width at 390").toBe(1);
});
