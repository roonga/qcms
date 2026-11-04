import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ResponseDetail } from "./response-detail.tsx";
import { t } from "../../lib/i18n/en.ts";
import type { ResponseDetail as ResponseDetailData } from "../../lib/ops/types.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

const DETAIL: ResponseDetailData = {
  sessionId: "ses_01HQ",
  formId: "form-1",
  formVersion: 3,
  submittedAt: "2026-01-01T00:00:00.000Z",
  accessMode: "anonymous",
  flaggedReason: "min_time",
  contentHash: "sha256:0000",
  answers: { q_name: "Sam" },
  ledger: [
    {
      questionId: "q_name",
      value: "Sam",
      retracted: false,
      answeredAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

function renderDetail(props: {
  readonly erase?: () => Promise<never>;
  readonly unflag?: () => Promise<never>;
}): void {
  render(
    <ResponseDetail
      detail={DETAIL}
      pins={[]}
      labels={new Map()}
      labelsFailed={false}
      linksHref="/operations/forms/form-1/links"
      environment="test"
      erasable
      erase={props.erase ?? (() => Promise.resolve({ status: "error" as const }))}
      unflag={props.unflag ?? (() => Promise.resolve({ status: "error" as const }))}
    />,
  );
}

describe("a rejected response action", { timeout: 30_000 }, () => {
  it("says the event was not released", async () => {
    const user = userEvent.setup();
    renderDetail({ unflag: transportFailure });

    await user.click(screen.getByRole("button", { name: t("ops.detail.unflag") }));
    await user.click(await screen.findByRole("button", { name: t("ops.detail.confirmUnflag") }));

    expect(
      await screen.findByText(t("ops.detail.unflagFailed", { message: unexpected() })),
    ).toBeTruthy();
  });

  it("says nothing was erased, and does not draw a tombstone", async () => {
    const user = userEvent.setup();
    renderDetail({ erase: transportFailure });

    await user.click(screen.getByRole("button", { name: t("ops.erase.button") }));
    const dialog = await screen.findByTestId("qcms-erase-dialog");

    await user.type(
      within(dialog).getByRole("textbox", { name: t("ops.erase.confirmLabel") }),
      DETAIL.sessionId,
    );
    await user.click(within(dialog).getByRole("button", { name: t("ops.erase.confirm") }));

    expect(await screen.findByText(t("ops.erase.failed", { message: unexpected() }))).toBeTruthy();
    expect(screen.queryByTestId("qcms-tombstone")).toBeNull();
  });
});
