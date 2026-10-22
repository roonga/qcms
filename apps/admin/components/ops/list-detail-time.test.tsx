import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResponseDetail as ResponseDetailData } from "../../lib/ops/types.ts";

/**
 * The responses list and a response's detail page name the same day and zone for one
 * submission (Code Owner ruling 2026-10-19, local UX list A9).
 *
 * What prompted the ruling: one submission read as Oct 17 on the list and Oct 18 on its
 * detail, because one surface was still showing the pinned-UTC first render while the
 * other had moved to the operator's clock. Both now go through
 * `components/operator-time.tsx`, which never paints UTC, so the two must agree for an
 * instant that falls on different days in UTC and in the operator's zone.
 *
 * The router is the one thing stubbed: the browser pushes a URL on Apply, which a static
 * tree has no app router for.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

const { ResponseBrowser } = await import("./response-browser.tsx");
const { ResponseDetail } = await import("./response-detail.tsx");

/** 23:30 UTC on 17 October is already 18 October in Sydney (UTC+11 in October). */
const SUBMITTED = "2026-10-17T23:30:00.000Z";

const DETAIL: ResponseDetailData = {
  sessionId: "ses_01HQ",
  formId: "form-1",
  formVersion: 3,
  submittedAt: SUBMITTED,
  accessMode: "anonymous",
  flaggedReason: null,
  contentHash: "sha256:0000",
  answers: {},
  ledger: [],
};

const originalZone = process.env.TZ;
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

function submittedTextIn(container: HTMLElement): string {
  const time = container.querySelector<HTMLTimeElement>(`time[datetime="${SUBMITTED}"]`);
  expect(time, "the submission time must render as a <time>").not.toBeNull();
  return time!.textContent ?? "";
}

describe("one submission on the list and on its detail", () => {
  it("names the same day and the same zone on both, on the operator's clock", () => {
    process.env.TZ = "Australia/Sydney";

    const list = render(
      <ResponseBrowser
        formId="form-1"
        versions={[3]}
        filters={{ version: "", from: "", to: "", flagged: "" }}
        hasFilters={false}
        page={{
          ok: true,
          data: {
            responses: [
              {
                sessionId: DETAIL.sessionId,
                formVersion: 3,
                submittedAt: SUBMITTED,
                accessMode: "anonymous",
                flaggedReason: null,
                answers: {},
              },
            ],
            page: 1,
            pageSize: 50,
            total: 1,
          },
        }}
      />,
    );
    const onList = submittedTextIn(list.container);
    list.unmount();

    const detail = render(
      <ResponseDetail
        detail={DETAIL}
        pins={[]}
        labels={new Map()}
        labelsFailed={false}
        linksHref="/forms/form-1/links"
        environment="test"
        erase={() => Promise.resolve({ status: "error" as const })}
        unflag={() => Promise.resolve({ status: "error" as const })}
      />,
    );
    const onDetail = submittedTextIn(detail.container);
    detail.unmount();

    expect(onList).toBe(onDetail);
    expect(onList.replace(/\u202f/gu, " ")).toMatch(/^18 Oct 2026, 10:30 (AEDT|GMT\+11)$/u);
    expect(onList).not.toContain("UTC");
  });
});
