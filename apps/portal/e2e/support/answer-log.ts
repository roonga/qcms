/**
 * The answer-post recorder the commit-moment and clear-path specs share
 * (issues #31, #98).
 *
 * "The answer eventually posts" passes on almost any broken cadence, so a spec
 * about WHEN and WHAT the portal posts needs the complete history rather than a
 * sample: register the watcher before the flow starts, then a count taken after an
 * awaited post is an accounting of everything that happened before it (answer posts
 * are serialized and ordered). Assertions then pin the exact number of posts per
 * question AND each post's body, which is the only way to tell an answer of the
 * empty set (`[]`) from a retraction (`null`) from an empty-string answer (`""`).
 */

import { expect, type Page, type Request } from "@playwright/test";

/** One recorded `POST /answers`: what it carried and how the API answered. */
export interface AnswerPost {
  readonly questionId: string;
  readonly value: unknown;
  readonly status: number;
}

/** Record every answer post the page makes, in order, for the whole test. */
export function watchAnswerPosts(page: Page): AnswerPost[] {
  const log: AnswerPost[] = [];
  page.on("response", (response) => {
    const request: Request = response.request();
    if (request.method() !== "POST" || !response.url().includes("/answers")) return;
    const body = JSON.parse(request.postData() ?? "{}") as {
      questionId?: string;
      value?: unknown;
    };
    log.push({
      questionId: body.questionId ?? "",
      value: body.value,
      status: response.status(),
    });
  });
  return log;
}

/** The posts recorded for one question, in order. */
export function postsFor(log: readonly AnswerPost[], questionId: string): AnswerPost[] {
  return log.filter((post) => post.questionId === questionId);
}

/**
 * Every answer post so far was accepted. A 422 here means the portal sent
 * something the API refuses: the null-post defect (issue #95, resolved by PR #97),
 * or an empty-value answer the question's constraints reject (issue #98, where an
 * emptied text field posted `""` and an all-unchecked group posted `[]`, both
 * rejected while the server kept the stale answer). Neither may reappear.
 */
export function expectNoRejectedPosts(log: readonly AnswerPost[]): void {
  expect(log.filter((post) => post.status !== 200)).toEqual([]);
}
