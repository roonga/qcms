/**
 * Full-stack kitchen-sink flow (task 045, ADR-28). Drives every one of the seven
 * question types across three steps via explicit Continue/Back navigation, submits
 * from the final step, and then opens its OWN Postgres connection to verify what
 * was persisted - independently of the API's response echo (exit criterion 4).
 *
 * The exit criteria this spec proves:
 * - 1: start -> through every step via Continue -> Submit -> completion receipt.
 * - M (multi-choice): selecting 2+ options keeps them all (the step never
 *      collapses on answer).
 * - G (Back): Back from step k returns to k-1 with the prior answers shown.
 * - N (final Submit): completes without regressing to an earlier step.
 * - 4: independent DB verification - canonical stored answers per type,
 *      append-only ledger (a Back-and-change adds a row), and the submission lock.
 *
 * It runs at three viewports (phone / tablet / desktop) via the config projects,
 * and inherits the browser + server error gates from `support/gates.ts`.
 */

import { test, expect } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerNumber,
  backStep,
  chooseFromSelect,
  chooseRadio,
  chooseSingleChoice,
  checkOption,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

test("kitchen-sink: every type via Continue/Back, Submit, and independent DB verification", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(sessionId).toMatch(/^ses_/);

  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByTestId("back-action")).toHaveCount(0);
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990"); // 1990-05-17, given as MMDDYYYY whatever the field order
  await continueStep(page);

  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(page.getByTestId("back-action")).toBeVisible();

  await chooseRadio(page, "Yes"); // reveals q_accident_count
  await expect(page.getByText("How many?")).toBeVisible();
  await answerNumber(page, "10");

  await checkOption(page, "Breakdown");
  await checkOption(page, "Windscreen");
  await expect(page.getByRole("checkbox", { name: "Breakdown", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Windscreen", exact: true })).toBeChecked();

  await fillText(page, KS.extraDetail, "No claims in 5 years");

  await backStep(page);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("Ada Lovelace");
  await fillText(page, KS.fullName, "Grace Hopper");
  await continueStep(page);

  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Windscreen", exact: true })).toBeChecked();
  await continueStep(page);

  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await chooseSingleChoice(page, "Standard");
  await chooseFromSelect(page, "q_body_type", "Wagon");

  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);

  const db = await openDb(databaseUrl);
  try {
    const latest = await db.latestAnswers(sessionId);
    expect(latest.get("q_full_name")).toBe("Grace Hopper"); // the changed value wins
    expect(latest.get("q_dob")).toBe("1990-05-17");
    expect(latest.get("q_at_fault_accident")).toBe(true);
    expect(latest.get("q_accident_count")).toBe(10);
    expect(latest.get("q_optional_cover")).toEqual(["opt_breakdown", "opt_windscreen"]);
    expect(latest.get("q_extra_detail")).toBe("No claims in 5 years");
    expect(latest.get("q_coverage_level")).toBe("opt_standard");
    expect(latest.get("q_body_type")).toBe("opt_wagon");

    const nameRows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_full_name");
    expect(nameRows.map((r) => r.value)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(await db.answerCount(sessionId, "q_full_name")).toBe(2);
    expect(await db.answerCount(sessionId, "q_optional_cover")).toBeGreaterThanOrEqual(2);

    const submission = await db.submission(sessionId);
    expect(submission).not.toBeNull();
    expect(submission?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(submission?.submittedAt).toBeTruthy();
  } finally {
    await db.close();
  }
});
