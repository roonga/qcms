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
    const body = JSON.parse(request.postData() || "{}") as {
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

export function expectNoRejectedPosts(log: readonly AnswerPost[]): void {
  expect(log.filter((post) => post.status !== 200)).toEqual([]);
}
