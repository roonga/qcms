/**
 * What the hydrated flow does around a press of Continue, and when a round trip does not
 * go the way the press expected (local UX list P2, P4 and P9).
 *
 * - **P4.** Leaving a field posts its answer (ADR-31), and the flow used to mark Continue
 *   and Back `disabled` while that post was in flight. The blur happens on pointer DOWN,
 *   so by pointer UP the button was disabled and the click never fired: the first press
 *   after typing did nothing. The first test reproduces exactly that gap, with the save
 *   held open between the two halves of the press.
 * - **P2.** An expired or already-submitted session is refused with a 409 the page's own
 *   server render has a screen for, and the hydrated flow read it as a network failure
 *   and said "We could not reach the server" for ever. The refusals here are REAL: the
 *   session row is changed under the page, as time or another tab would change it.
 * - **P9.** The failure notice was never cleared and was drawn at the top of the card,
 *   away from the button that caused it. It now sits beside the actions, offers a retry,
 *   and goes away when the retry gets through.
 *
 * The rules behind the last two are pure functions pinned in `lib/flow-outcome.test.ts`;
 * what only this layer can show is that the component wires them to real responses.
 */

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

/**
 * Issue #1041's not-visible branch, live since the refusal body is read once (local UX
 * list P2). On `main` the second of two body reads found the body consumed, so a
 * `QUESTION_NOT_VISIBLE` 409 painted "We could not reach the server" for good. It now
 * re-reads the step the respondent is ON, at the committed cursor, so posting an answer
 * never moves the page (ADR-28) and no failure notice appears.
 *
 * The 409 is a fulfilled route: making the real API refuse a visible control would need
 * a race between two projections, and what is under test is the client's answer to the
 * refusal, not the API's reasons for sending it.
 */
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
