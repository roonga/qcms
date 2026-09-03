import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ResponseDetail } from "./response-detail.tsx";
import { t } from "../../lib/i18n/en.ts";
import type { ResponseDetail as ResponseDetailData } from "../../lib/ops/types.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an operator sees when releasing a withheld event or erasing a response REJECTS
 * (issue #352, handlers 8 and 9 of nine).
 *
 * The erasure one is the worst place in the app for this failure and is the reason the
 * class was worth chasing: an ADR-17 erasure is irreversible, so an operator who confirms
 * one and is told nothing cannot tell whether it ran. It did not, and the sentence has to
 * say so.
 *
 * The actions are props, so the fakes are the props; the confirmation gate, the
 * `useTransition`, the `.then` chains and the alerts are all the real component.
 */

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
    { questionId: "q_name", value: "Sam", retracted: false, answeredAt: "2026-01-01T00:00:00.000Z" },
  ],
};

/** The rejection an unreachable API produces, which is the whole subject here. */
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
      linksHref="/forms/form-1/links"
      erase={props.erase ?? (() => Promise.resolve({ status: "error" as const }))}
      unflag={props.unflag ?? (() => Promise.resolve({ status: "error" as const }))}
    />,
  );
}

// react-aria interaction under jsdom is CPU-bound, and the erase gate requires typing a
// full session id before its confirm button leaves the disabled state.
describe("a rejected response action", { timeout: 30_000 }, () => {
  it("says the event was not released", async () => {
    const user = userEvent.setup();
    renderDetail({ unflag: transportFailure });

    await user.click(screen.getByRole("button", { name: t("ops.detail.unflag") }));
    await user.click(
      await screen.findByRole("button", { name: t("ops.detail.confirmUnflag") }),
    );

    expect(
      await screen.findByText(t("ops.detail.unflagFailed", { message: unexpected() })),
    ).toBeTruthy();
  });

  it("says nothing was erased, and does not draw a tombstone", async () => {
    const user = userEvent.setup();
    renderDetail({ erase: transportFailure });

    await user.click(screen.getByRole("button", { name: t("ops.erase.button") }));
    const dialog = await screen.findByTestId("qcms-erase-dialog");

    // The confirm button is gated on typing the session id back, so the action cannot be
    // reached without answering that field for real.
    await user.type(
      within(dialog).getByRole("textbox", { name: t("ops.erase.confirmLabel") }),
      DETAIL.sessionId,
    );
    await user.click(within(dialog).getByRole("button", { name: t("ops.erase.confirm") }));

    expect(
      await screen.findByText(t("ops.erase.failed", { message: unexpected() })),
    ).toBeTruthy();
    // The second half, and the one that matters most here: a tombstone is drawn from the
    // outcome the action returns, so its absence is the screen stating that the
    // irreversible half did not happen.
    expect(screen.queryByTestId("qcms-tombstone")).toBeNull();
  });
});
