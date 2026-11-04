import type { Page } from "@playwright/test";

import {
  addStep,
  createForm,
  openStep,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
} from "./forms.js";
import { confirmLifecycle, createDraft } from "./questions.js";

// Pin the published version before deprecating it to obtain a real step-attributed DEPRECATED_PIN badge.

export const RAIL_FORM_TITLE = "Household cover";

export const RAIL_LONG_STEP_TITLE =
  "Household members, their vehicles and the drivers who use them";

// Keep the short title disjoint from the long one so text-filtered row locators cannot match both.
export const RAIL_SHORT_STEP_TITLE = "Cover";

export interface RailFixture {
  readonly formId: string;
  readonly slug: string;
  readonly badgedStepTitle: string;
}

export async function createRailFixture(page: Page, run: string): Promise<RailFixture> {
  // Each step needs a distinct question: the kernel refuses duplicate pins within a form.
  const questionSlug = `e2e-rail-${run}`;
  const questionId = `q_${questionSlug.replaceAll("-", "_")}`;
  const secondSlug = `e2e-rail-two-${run}`;
  const secondId = `q_${secondSlug.replaceAll("-", "_")}`;

  await createDraft(page, questionSlug, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, secondSlug, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  const slug = `rail-${run}`;
  const formId = await createForm(page, slug, RAIL_FORM_TITLE);

  // Pin each step before adding the next; an empty step pauses autosave.
  await addStep(page, RAIL_LONG_STEP_TITLE);
  await openStep(page, RAIL_LONG_STEP_TITLE);
  await pinQuestion(page, questionId, 1);
  // Take the baseline before creating the empty second step, which pauses autosave.
  // Wait for the second pin to change that baseline before navigating away; a previous saved label is insufficient.
  const beforeSecondPin = await savedStamp(page);
  await addStep(page, RAIL_SHORT_STEP_TITLE);
  await openStep(page, RAIL_SHORT_STEP_TITLE);
  await pinQuestion(page, secondId, 1);
  await waitForSaveAfter(page, beforeSecondPin);

  // Create a published successor before deprecating the pinned version.
  await page.goto(`/questions/${questionId}`);
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await page.goto(`/questions/${questionId}?v=1`);
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");

  return { formId, slug, badgedStepTitle: RAIL_LONG_STEP_TITLE };
}
