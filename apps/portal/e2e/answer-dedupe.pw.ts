import { test, expect } from "./support/gates.js";

import { expectNoRejectedPosts, postsFor, watchAnswerPosts } from "./support/answer-log.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerPosted,
  blurActive,
  clearText,
  commitCheckboxGroup,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
  toggleOption,
} from "./support/kitchen-sink.js";

test("a change-commit control blurred before its post resolves posts exactly once", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/answers", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { questionId?: string };
    if (body.questionId === "q_at_fault_accident") await held;
    await route.continue();
  });

  const posted = answerPosted(page);
  await page.getByText("No", { exact: true }).click();
  await blurActive(page);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  release();
  await posted;

  await toggleOption(page, "Breakdown");
  await commitCheckboxGroup(page);

  expect(postsFor(log, "q_at_fault_accident")).toEqual([
    { questionId: "q_at_fault_accident", value: false, status: 200 },
  ]);
  expectNoRejectedPosts(log);
});

test("the dedupe keeps absence distinct from a value, and an unchanged value posts nothing", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  const log = watchAnswerPosts(page);

  await startKitchenSink(page, kitchenSinkSlug);
  const name = page.getByRole("textbox", { name: KS.fullName });

  await fillText(page, KS.fullName, "Ada Lovelace");

  await name.click();
  await blurActive(page);

  await clearText(page, KS.fullName);
  await fillText(page, KS.fullName, "Ada Lovelace");

  await name.click();
  await blurActive(page);

  await enterDate(page, "05171990"); // serialization anchor, as above
  expect(postsFor(log, "q_full_name")).toEqual([
    { questionId: "q_full_name", value: "Ada Lovelace", status: 200 },
    { questionId: "q_full_name", value: null, status: 200 },
    { questionId: "q_full_name", value: "Ada Lovelace", status: 200 },
  ]);
  expectNoRejectedPosts(log);
});
