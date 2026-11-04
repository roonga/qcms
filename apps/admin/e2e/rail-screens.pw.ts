import { setScreenEnvironment } from "./support/environment.js";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openRail } from "./support/forms.js";
import { submitResponse } from "./support/ops.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("rail561");

const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const STEP_ID = "stp_history";
const STEP_TITLE = "Driving history";
const ACCIDENT = "q_at_fault_accident";

const SIDEBAR = 1024;

let totpSecret = "";

let sessionId = "";

interface Screen {
  readonly path: string;

  readonly current: string;

  readonly children: boolean;

  readonly title: string;
}

function screens(): readonly Screen[] {
  return [
    {
      path: `/forms/${FORM_ID}`,
      current: "section:builder",
      children: true,
      title: `Form details: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/rules`,
      current: "section:rules",
      children: true,
      title: `Rules: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/preview`,
      current: "section:preview",
      children: true,
      title: `Preview: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/versions`,
      current: "section:versions",
      children: true,
      title: `Versions: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/publish`,
      current: "section:publish",
      children: true,
      title: `Publish: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/versions/1`,
      current: "section:versions",
      children: true,
      title: `Version 1: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/links`,
      current: "section:links",
      children: true,
      title: `Links: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/responses`,
      current: "section:responses",
      children: true,
      title: `Responses: ${FORM_ID} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/responses/${sessionId}`,
      current: "section:responses",
      children: true,

      title: `Response ${sessionId} - QCMS`,
    },
    {
      path: `/forms/${FORM_ID}/webhooks`,
      current: "section:webhooks",
      children: true,
      title: `Webhooks: ${FORM_ID} - QCMS`,
    },
  ];
}

async function childHrefs(page: Page): Promise<string[]> {
  return page
    .locator('[data-rail-group="steps"] a')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
}

async function childSelects(page: Page): Promise<string[]> {
  return page
    .locator('[data-rail-group="steps"] [data-rail-step-select]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-rail-step-select") ?? ""));
}

async function childSteps(page: Page): Promise<string[]> {
  const hrefs = await childHrefs(page);
  return hrefs.length > 0 ? hrefs : childSelects(page);
}

// Keep shared setup in beforeAll so filtering any test does not remove its fixture.
test.beforeAll(async ({ browser }) => {
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  try {
    totpSecret = await enrollNewAdmin(page, EMAIL);
    sessionId = await submitResponse(SLUG, [[ACCIDENT, false]]);
  } finally {
    await page.close();
  }
});

test("561 puts the rail on all ten form-scoped screens, marking the row the screen is", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  for (const screen of screens()) {
    await setScreenEnvironment(page, screen.path);
    await page.goto(screen.path);
    await expect(page.locator("main#main-content"), `${screen.path} is the shell`).toHaveCount(1);

    await expect
      .soft(page.getByTestId("qcms-rail"), `${screen.path} carries the rail`)
      .toBeVisible();

    await expect.soft(page, `${screen.path} names its own browser tab`).toHaveTitle(screen.title);
    await expect
      .soft(
        page.locator(`.qcms-rail__link[data-rail-item="${screen.current}"]`),
        `${screen.path} marks ${screen.current} as the current row`,
      )
      .toHaveAttribute("aria-current", "page");
    await expect
      .soft(
        page.locator('.qcms-rail__link[aria-current="page"]'),
        `${screen.path} marks exactly one row`,
      )
      .toHaveCount(1);

    await expect
      .soft(page.locator('[data-rail-group="sections"]'), `${screen.path} has the sibling group`)
      .toHaveCount(1);
    await expect
      .soft(
        page.getByRole("navigation", { name: "Form sections" }),
        `${screen.path} has no second section nav`,
      )
      .toHaveCount(0);

    await expect
      .soft(page.locator('[data-rail-group="steps"]'), `${screen.path} carries the form's steps`)
      .toHaveCount(screen.children ? 1 : 0);

    await expect
      .soft(
        page.locator(
          '[data-rail-group="sections"] > li:has([data-rail-item="section:builder"]) [data-rail-group="steps"]',
        ),
        `${screen.path} nests them inside the Form row`,
      )
      .toHaveCount(1);

    await expect
      .soft(page.locator("hr.qcms-rail__divider"), `${screen.path} draws no divider`)
      .toHaveCount(0);
  }
});

test("561 gives every screen the form's steps as its children, never the list it is showing", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: SIDEBAR, height: 900 });

  const linked = [`/forms/${FORM_ID}#step-${STEP_ID}`];
  const selected = [STEP_TITLE];

  for (const screen of screens()) {
    await setScreenEnvironment(page, screen.path);
    await page.goto(screen.path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    const children = await childSteps(page);

    const shape = children[0]?.startsWith("/") === true ? linked : selected;
    expect
      .soft(
        children,
        screen.children
          ? `${screen.path} lists the form's steps as its children`
          : `${screen.path} carries no children group at all`,
      )
      .toEqual(screen.children ? shape : []);
  }

  await setScreenEnvironment(page, `/forms/${FORM_ID}`);
  await page.goto(`/forms/${FORM_ID}`);
  const railStep = page
    .getByTestId("qcms-rail")
    .getByRole("button", { name: new RegExp(STEP_TITLE) });
  await expect(railStep.first(), "the rail's step row is a button that selects").toBeVisible();
  await expect(
    page.locator(`main#main-content [data-rail-step-select]`),
    "and the page carries no second step list",
  ).toHaveCount(0);

  await expect(
    page.locator(`#step-${STEP_ID}`),
    "the step every screen's rail links to is present to be linked to",
  ).toHaveCount(1);
});

test("561 keeps the two respondent-facing renders on the narrow measure the rail sits beside", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  for (const path of [`/forms/${FORM_ID}/preview`, `/forms/${FORM_ID}/versions/1`]) {
    await setScreenEnvironment(page, path);
    await page.goto(path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    const frame = page.getByTestId("qcms-respondent-frame");
    await expect(frame, `${path} renders the drawn frame`).toBeVisible({ timeout: 60_000 });
    const measured = await frame.evaluate((element) => element.getBoundingClientRect().width);
    expect.soft(measured, `${path} renders a respondent at a respondent's width`).toBe(640);
    const column = await page.locator("main#main-content").evaluate((element) => {
      const rail = document.querySelector(".qcms-rail")?.getBoundingClientRect();
      return {
        cap: Number.parseFloat(getComputedStyle(element).maxWidth),
        width: element.getBoundingClientRect().width,

        available: document.documentElement.clientWidth - (rail?.width ?? 0),
      };
    });
    expect.soft(column.cap, `${path} caps its column at the POC's outer number`).toBe(1600);
    expect
      .soft(column.width, `${path} still fills the space the rail leaves it`)
      .toBe(column.available);
  }
});

test("561 puts every shared rail row in the same box on all three builder-family screens", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Round measured gaps to avoid subpixel layout noise.
  const boxes = async (): Promise<Record<string, string>> =>
    page.locator("[data-rail-item]").evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node, index) => {
          const box = node.getBoundingClientRect();
          const previous = index === 0 ? undefined : nodes[index - 1]?.getBoundingClientRect();
          const gap =
            previous === undefined ? "first" : String(Math.round(box.top - previous.bottom));
          return [
            node.getAttribute("data-rail-item") ?? "",
            `left=${String(Math.round(box.left))} width=${String(Math.round(box.width))} height=${String(Math.round(box.height))} gapAbove=${gap}`,
          ];
        }),
      ),
    );

  // Use the server-rendered Preview rail as the settled reference for client-rendered rails.
  await setScreenEnvironment(page, `/forms/${FORM_ID}/preview`);
  await page.goto(`/forms/${FORM_ID}/preview`);
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
  await openRail(page);
  const onPreview = await boxes();
  // Compare row gaps rather than absolute positions: stored server verdicts can add badges absent from an unvalidated builder.

  await setScreenEnvironment(page, `/forms/${FORM_ID}`);

  await page.goto(`/forms/${FORM_ID}`);
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
  await openRail(page);

  await expect(page.locator("[data-rail-step-select]").first()).toBeVisible();
  const onBuilder = await boxes();

  await page.locator('[data-rail-item="section:rules"]').click();
  await expect(page).toHaveURL(/\/rules$/u);
  await expect(page.locator("#qcms-rules-heading")).toBeAttached();
  await expect(page.locator('[data-rail-item^="step:"]').first()).toBeVisible();
  const onRules = await boxes();

  const shared = Object.keys(onBuilder).filter((key) => key in onRules && key in onPreview);
  expect(shared.length, "the three screens share rows to compare").toBeGreaterThan(4);

  for (const key of shared) {
    const spansTheSteps = key === "section:rules";
    const strip = (value: string): string =>
      spansTheSteps ? value.replace(/ gapAbove=\S+$/u, "") : value;
    expect
      .soft(strip(onRules[key] ?? ""), `${key} is the same row on the builder and the rules screen`)
      .toBe(strip(onBuilder[key] ?? ""));
    expect
      .soft(strip(onPreview[key] ?? ""), `${key} is the same row on the builder and preview`)
      .toBe(strip(onBuilder[key] ?? ""));
  }

  for (const [screen, path] of [
    ["builder", `/forms/${FORM_ID}`],
    ["preview", `/forms/${FORM_ID}/preview`],
  ] as const) {
    await setScreenEnvironment(page, path);
    await page.goto(path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    await openRail(page);
    await expect(
      page.locator("[data-rail-item^='step:'], [data-rail-step-select]").first(),
    ).toBeVisible();
    const measured = await page

      .locator("[data-rail-item], [data-rail-step-select], .qcms-rail__actions")
      .evaluateAll((nodes) =>
        nodes.map((node, index) => {
          const box = node.getBoundingClientRect();
          const previous = index === 0 ? undefined : nodes[index - 1]?.getBoundingClientRect();
          return {
            gap: previous === undefined ? null : Math.round(box.top - previous.bottom),
            height: Math.round(box.height),
            isAdd: node.classList.contains("qcms-rail__actions"),
          };
        }),
      );
    expect(measured.length, `${screen} renders rail rows to measure`).toBeGreaterThan(6);
    for (const [index, row] of measured.entries()) {
      if (row.gap !== null) {
        expect
          .soft([2, 8], `${screen} row ${String(index)} sits on the rail's rhythm`)
          .toContain(row.gap);
      }

      if (row.isAdd) {
        expect.soft(row.height, `${screen}'s actions part is one row tall`).toBe(40);
      }
    }
  }
});

test("1116 heads every form screen's rail the same way, and leaves no breadcrumb behind", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const headers: string[] = [];

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of screens()) {
      await setScreenEnvironment(page, screen.path);
      await page.goto(screen.path);
      const rail = page.getByTestId("qcms-rail");
      await expect.soft(rail, `${screen.path} at ${String(width)} carries the rail`).toBeVisible();

      await expect
        .soft(
          rail.getByRole("link", { name: "Forms", exact: true }),
          `${screen.path} at ${String(width)} offers the way back to Forms`,
        )
        .toBeVisible();

      const summary = rail.locator("summary.qcms-rail__summary");
      await expect
        .soft(summary, `${screen.path} at ${String(width)} names the form in its Header`)
        .toBeVisible();
      const name = ((await summary.textContent()) ?? "").trim();
      expect
        .soft(name.length, `${screen.path} at ${String(width)} has a Header with text in it`)
        .toBeGreaterThan(0);
      headers.push(`${screen.path} @${String(width)}: ${name}`);
      await expect
        .soft(
          summary.locator(".qcms-tag[data-status]"),
          `${screen.path} at ${String(width)} states the form's status once`,
        )
        .toHaveCount(1);

      await expect
        .soft(
          page.locator('main#main-content [aria-label="Breadcrumb"]'),
          `${screen.path} at ${String(width)} has no breadcrumb in its column`,
        )
        .toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: SIDEBAR, height: 900 });

  const names = new Set(headers.map((entry) => entry.split(": ").slice(1).join(": ")));
  expect([...names], `every screen's Header reads the same: ${headers.join(" | ")}`).toHaveLength(
    1,
  );
});
