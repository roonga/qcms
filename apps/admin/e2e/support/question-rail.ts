import type { Page } from "@playwright/test";

import { confirmLifecycle, createDraft } from "./questions.js";

// Create versions through the real lifecycle: deprecation needs a successor and each new draft starts from the latest.

export interface QuestionRailFixture {
  readonly questionId: string;
  readonly draftVersion: number;
  readonly publishedVersion: number;
  readonly deprecatedVersion: number;
}

// Use a unique run identifier because the suite shares a database and derives question IDs from slugs.
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

  await page.goto(`/questions/${questionId}?v=1`);
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");
  await page.goto(`/questions/${questionId}`);

  return { questionId, draftVersion: 3, publishedVersion: 2, deprecatedVersion: 1 };
}
