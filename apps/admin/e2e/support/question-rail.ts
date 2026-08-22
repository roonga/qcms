import type { Page } from "@playwright/test";

import { confirmLifecycle, createDraft } from "./questions.js";

/**
 * The fixture the question rail's evidence needs, built through the app (issue 650).
 *
 * The rail's whole content is one question's version list, so what it needs is a question
 * with more than one version and with more than one status among them. The seeded library
 * has neither: its questions are published at v1 and left there, which would show a rail of
 * a single row and prove nothing about the marked row, the digest or the status tags.
 *
 * ## Why the states are reached the long way round
 *
 * Every step below is the sequence an operator actually walks, because that is the only
 * sequence the API allows. A version cannot be deprecated until a successor exists (a
 * library with nothing current is not a state the kernel will enter), and a new draft is
 * always minted from the latest, so "v1 deprecated, v2 published, v3 draft" can only be
 * built forwards. Manufacturing it behind the app's back would also be manufacturing a
 * state the screen may never meet.
 */

/** What the fixture built, for a spec that has to address it. */
export interface QuestionRailFixture {
  readonly questionId: string;
  /** The draft at the top of the list, and the version the screen opens on. */
  readonly draftVersion: number;
  /** The version the digest names as published. */
  readonly publishedVersion: number;
  /** The version whose row carries the deprecated tag. */
  readonly deprecatedVersion: number;
}

/**
 * Build a question with three versions in three different states, and leave the page on its
 * detail screen with the newest selected.
 *
 * `run` makes the id unique per run, because the suite shares one database and a question id
 * is minted from its slug.
 */
export async function createQuestionRailFixture(
  page: Page,
  run: string,
): Promise<QuestionRailFixture> {
  const slug = `e2e-qrail-${run}`;
  const questionId = `q_${slug.replaceAll("-", "_")}`;

  await createDraft(page, slug, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=3$/);

  // Deprecation is a property of one published version, so it is done from that version's
  // own address rather than from the draft the page is sitting on.
  await page.goto(`/questions/${questionId}?v=1`);
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");
  await page.goto(`/questions/${questionId}`);

  return { questionId, draftVersion: 3, publishedVersion: 2, deprecatedVersion: 1 };
}
