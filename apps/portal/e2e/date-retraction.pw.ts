import { test, expect } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { KS, clearDate, enterDate, fillText, startKitchenSink } from "./support/kitchen-sink.js";

test("clearing an answered required date retracts it and Continue no longer advances", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(sessionId).toMatch(/^ses_/);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");

  await clearDate(page);

  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driving history" })).toHaveCount(0);
  await expect(page.getByTestId("error-summary")).toContainText(KS.dob);
  await expect(page.getByTestId("error-summary")).not.toContainText(KS.fullName);
  await expect(
    page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /month/i }),
  ).toHaveText(/mm/i);

  await enterDate(page, "05171990");
  await page.getByTestId("primary-action").click();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  const db = await openDb(databaseUrl);
  try {
    const latest = await db.latestAnswers(sessionId);
    expect(latest.get("q_dob")).toBe("1990-05-17");
    expect(latest.get("q_full_name")).toBe("Ada Lovelace");

    const dobRows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_dob");
    expect(dobRows.map((r) => [r.value, r.retracted])).toEqual([
      ["1990-05-17", false],
      [null, true],
      ["1990-05-17", false],
    ]);
  } finally {
    await db.close();
  }
});
