import { test, expect } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  blurActive,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
  stepServed,
} from "./support/kitchen-sink.js";

import type { Page } from "@playwright/test";

/** The session id in the URL the Start button landed on. */
function sessionIdOf(url: string): string {
  return new URL(url).pathname.split("/")[2] ?? "";
}

/** Let the page paint whatever the last event scheduled (two animation frames). */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/** Count the step reads (`GET .../step`) the page makes from now on. */
function countStepReads(page: Page): { readonly count: () => number } {
  let reads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname.endsWith("/step")) {
      reads += 1;
    }
  });
  return { count: () => reads };
}

const LOST = "We could not reach the server. Please try again.";

test("the first Continue after typing is not lost while the blur's save is in flight (P4)", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await enterDate(page, "05171990");

  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = (): void => {};
  const postIssued = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route("**/answers", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { questionId?: string };
    if (body.questionId === "q_full_name") {
      arrived();
      await held;
    }
    await route.continue();
  });

  await page.getByRole("textbox", { name: KS.fullName }).fill("Ada Lovelace");
  const primary = page.getByTestId("primary-action");
  await primary.scrollIntoViewIfNeeded();
  const box = await primary.boundingBox();
  if (box === null) throw new Error("the primary action has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.mouse.down();
  await postIssued;
  await settleFrames(page);
  await page.mouse.up();

  const served = stepServed(page);
  release();
  await served;
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
});

test("a double press of Continue advances one step (P4)", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");

  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/step\?step=\d+$/, async (route) => {
    await held;
    await route.continue();
  });
  const reads = countStepReads(page);

  const primary = page.getByTestId("primary-action");
  await primary.scrollIntoViewIfNeeded();
  const box = await primary.boundingBox();
  if (box === null) throw new Error("the primary action has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await expect(primary).toHaveAttribute("aria-disabled", "true");
  await page.mouse.click(x, y);

  const served = stepServed(page);
  release();
  await served;
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(primary).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3");
  expect(reads.count()).toBe(1);
});

test("an expired session lands on the expired screen, not a network failure (P2)", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 409, url: /\/answers$/ });
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  expect(sessionId).toMatch(/^ses_/);

  const db = await openDb(databaseUrl);
  try {
    await db.expireSession(sessionId);
  } finally {
    await db.close();
  }

  await page.getByRole("textbox", { name: KS.fullName }).fill("Ada Lovelace");
  await blurActive(page);

  await expect(page.getByRole("heading", { name: "Your session has expired" })).toBeVisible();
  await expect(page.getByText(LOST)).toHaveCount(0);
});

test("a session submitted elsewhere lands on the completion screen on Continue (P2)", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 409, url: /\/step\?step=\d+$/ });
  const { kitchenSinkSlug, databaseUrl } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = sessionIdOf(page.url());
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");

  const db = await openDb(databaseUrl);
  try {
    await db.markSessionSubmitted(sessionId);
  } finally {
    await db.close();
  }

  await page.getByTestId("primary-action").click();

  await expect(
    page.getByRole("heading", { name: "Thank you, your responses were received" }),
  ).toBeVisible();
  await expect(page.getByText(LOST)).toHaveCount(0);
});

test("a failed Continue is reported beside the actions and its retry clears it (P9)", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 503, url: /\/step\?step=\d+$/ });
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");

  let failOnce = true;
  await page.route(/\/step\?step=\d+$/, async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, body: "" });
      return;
    }
    await route.continue();
  });

  const primary = page.getByTestId("primary-action");
  await primary.click();
  const notice = page.getByTestId("flow-failure");
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("alert")).toHaveText(LOST);
  await expect(notice).toBeInViewport();
  await expect(primary).toBeInViewport();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();

  const served = stepServed(page);
  await notice.getByRole("button", { name: "Try again" }).click();
  await served;
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("a not-visible refusal re-reads the current step and moves nothing (#1041)", async ({
  page,
  browserGuard,
}) => {
  browserGuard.expectRequestFailure({ status: 409, url: /\/answers$/ });
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  const heading = page.getByRole("heading", { name: "Driving history" });
  await expect(heading).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3");

  await page.route("**/answers", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { questionId?: string };
    if (body.questionId === "q_at_fault_accident") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "QUESTION_NOT_VISIBLE" } }),
      });
      return;
    }
    await route.continue();
  });
  const reread = page.waitForRequest(
    (request) => request.method() === "GET" && new URL(request.url()).pathname.endsWith("/step"),
  );
  const served = stepServed(page);

  await page.getByText("No", { exact: true }).click();

  const request = await reread;
  expect(new URL(request.url()).search).toBe("?step=1");
  await served;

  await expect(heading).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("Step 2 of 3");
  await expect(page.getByTestId("flow-failure")).toHaveCount(0);
  await expect(page.getByText(LOST)).toHaveCount(0);
});
