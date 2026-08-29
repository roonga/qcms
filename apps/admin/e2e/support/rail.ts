import type { Page } from "@playwright/test";

import { addStep, createForm, openStep, pinQuestion, waitForSaved } from "./forms.js";
import { confirmLifecycle, createDraft } from "./questions.js";

/**
 * The fixture the §7 rail's evidence needs, built through the app (issue 559).
 *
 * The seeded insurance form is one step called "Driving history" with no issues, which
 * exercises none of the three things the rail's acceptance turns on. This builds a form
 * that does, through the same screens an author would use, and it is shared by the
 * behaviour spec and the gate capture so the two are looking at the same thing.
 *
 * ## Why a step has to be given an issue the long way round
 *
 * The rail's per-step badge counts issues the API attributes to a step, and almost no
 * step-attributed issue is reachable through the builder: the library picker disables a
 * question that is already pinned (so no `DUPLICATE_QUESTION_IN_FORM`) and offers only
 * published versions (so no `UNPUBLISHED_QUESTION_PIN`), and a step with no pin at all
 * makes the whole definition unparseable, which the API answers with a 400 rather than
 * with issues.
 *
 * `DEPRECATED_PIN` is the one that is both reachable and ordinary: a form pins a published
 * version, the library deprecates that version afterwards, and the form is left holding a
 * pin the author is being asked to move (`deprecatedPinGate` in the API's form handler,
 * which reports it with the step in its path). So the question is created and published
 * here, pinned, and then deprecated - which is also the real sequence an operator meets,
 * rather than a state manufactured behind the app's back.
 */

/**
 * A step title long enough to overflow the 240px column, so a frame of the expanded rail
 * shows what a long author-supplied title actually does there (issues 582, 595, 596).
 */
/**
 * What this fixture's form is CALLED, as opposed to how it is addressed.
 *
 * Exported because the rail shows the title rather than the slug since 2026-08-26, so the
 * specs asserting what the rail says need the same string the fixture was built with.
 */
export const RAIL_FORM_TITLE = "Household cover";

export const RAIL_LONG_STEP_TITLE =
  "Household members, their vehicles and the drivers who use them";

/**
 * The second step's title. Short, and deliberately sharing no word with the long one: a
 * locator filtered by text would otherwise match both rows and fail in strict mode.
 */
export const RAIL_SHORT_STEP_TITLE = "Cover";

/** What the fixture built, for a spec that has to address it. */
export interface RailFixture {
  readonly formId: string;
  readonly slug: string;
  /** The step whose pin is deprecated, and therefore the step that carries a badge. */
  readonly badgedStepTitle: string;
}

/**
 * Build the fixture and leave the page on the form's builder.
 *
 * `run` makes every id unique per run, because the suite shares one database and a slug
 * is what a question id is minted from.
 */
export async function createRailFixture(page: Page, run: string): Promise<RailFixture> {
  // Two questions of this run's own, rather than the seeded library's: a pin has to be
  // one question per form (the kernel rejects a repeat), so the two steps need two, and
  // minting them here keeps the fixture independent of what the seed happens to publish.
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

  // Each step is pinned before the next is added: a step with no question in it is not a
  // parseable definition, so a draft saved in that state is refused by the API rather than
  // stored with issues.
  await addStep(page, RAIL_LONG_STEP_TITLE);
  await openStep(page, RAIL_LONG_STEP_TITLE);
  await pinQuestion(page, questionId, 1);
  await addStep(page, RAIL_SHORT_STEP_TITLE);
  await openStep(page, RAIL_SHORT_STEP_TITLE);
  await pinQuestion(page, secondId, 1);
  await waitForSaved(page);

  // Deprecation is a property of a published version and needs a successor to exist
  // first, which is the same order `questions-lifecycle.pw.ts` walks.
  await page.goto(`/questions/${questionId}`);
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await page.goto(`/questions/${questionId}?v=1`);
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");

  return { formId, slug, badgedStepTitle: RAIL_LONG_STEP_TITLE };
}
