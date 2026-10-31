import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PublishWizard } from "./publish-wizard.tsx";
import type { ReleaseReview } from "../../lib/forms/release-candidate.ts";
import { t } from "../../lib/i18n/en.ts";

/**
 * The publish wizard's three rejection handlers, and the properties its state machine
 * exists to hold (issue #352's rule, applied to issue #1197's wizard).
 *
 * Every call is a prop, so the fakes are the props and nothing else: the `.then` chains,
 * the `useTransition`, the state they set and the markup that reads it are all the real
 * component. `adminApiFetch` documents that it does not throw for a non-2xx, which is the
 * trap all three guard - a transport failure still rejects with a `TypeError`, and
 * `readResult`'s `response.json()` rejects on a truncated body.
 *
 * The confirm handler is the one that matters most, and it does not report an error: a
 * confirmation whose answer was lost may have committed, so the state is `uncertain` and
 * the operator is offered a result lookup. Reporting it as a failure would invite a second
 * press, and a second press of a *new* key would be the duplicate version the plan's
 * invariant forbids.
 */

const PROD_ONLY: ReleaseReview = {
  source: { kind: "version", version: 2, publishedBy: "usr_bob" },
  workflowRevision: null,
  workflowSource: "default",
  targets: [
    {
      environment: "prod",
      currentVersion: 1,
      currentSequence: 4,
      closed: false,
      evidence: [],
      blockers: [],
      twoPerson: { applies: true, refusedAsAuthor: false },
      protected: true,
    },
  ],
};

function transportFailure(): Promise<never> {
  return Promise.reject(new TypeError("fetch failed"));
}

/** Walk the wizard to the review step with `prod` chosen, which every case below needs. */
async function toReview(props: {
  readonly review?: () => Promise<{ ok: true; data: ReleaseReview } | { ok: false }>;
  readonly confirm?: Parameters<typeof PublishWizard>[0]["confirm"];
  readonly lookup?: Parameters<typeof PublishWizard>[0]["lookup"];
}) {
  const user = userEvent.setup();
  render(
    <PublishWizard
      formId="frm_intake"
      versions={[2, 1]}
      hasDraft={false}
      canPublishDraft={false}
      draft={null}
      review={props.review ?? (() => Promise.resolve({ ok: true, data: PROD_ONLY }))}
      confirm={props.confirm ?? (() => Promise.resolve({ status: "idle" }))}
      lookup={props.lookup ?? (() => Promise.resolve({ status: "idle" }))}
    />,
  );
  await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
  await user.click(await screen.findByRole("checkbox", { name: "prod" }));
  await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
  return user;
}

describe("a rejected review", () => {
  it("says the review could not be read, so nothing is offered to confirm", async () => {
    const user = userEvent.setup();
    render(
      <PublishWizard
        formId="frm_intake"
        versions={[2, 1]}
        hasDraft={false}
        canPublishDraft={false}
        draft={null}
        review={transportFailure}
        confirm={() => Promise.resolve({ status: "idle" })}
        lookup={() => Promise.resolve({ status: "idle" })}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));

    expect(await screen.findByText(t("forms.publish.reviewFailed"))).toBeTruthy();
    // Still on the source step: a step that advanced on a failed read would present an
    // empty destination list as "you may release nowhere".
    expect(screen.getByTestId("qcms-publish-wizard").dataset.step).toBe("source");
  });
});

describe("a confirmation whose answer is lost", () => {
  it("is uncertain rather than failed, and offers the result lookup", async () => {
    const user = await toReview({ confirm: transportFailure });

    await user.click(screen.getByRole("button", { name: t("forms.publish.wizardConfirm") }));

    expect(await screen.findByTestId("qcms-publish-uncertain")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("forms.publish.lookup") })).toBeTruthy();
  });

  it("resends the same idempotency key, so a retry cannot freeze a second version", async () => {
    const confirm = vi
      .fn<Parameters<typeof PublishWizard>[0]["confirm"]>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ status: "done", version: 3, releases: [], replayed: true });
    const user = await toReview({ confirm });

    await user.click(screen.getByRole("button", { name: t("forms.publish.wizardConfirm") }));
    await screen.findByTestId("qcms-publish-uncertain");
    await user.click(screen.getByRole("button", { name: t("forms.publish.wizardConfirm") }));

    await screen.findByTestId("qcms-publish-result");
    const first = confirm.mock.calls[0]?.[0];
    const second = confirm.mock.calls[1]?.[0];
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    // The replay is named, because "version 3 is published" after a timeout has to read as
    // the answer to the press that timed out and not as a second publish.
    expect(screen.getByText(t("forms.publish.result.replayed"))).toBeTruthy();
  });

  it("reports a rejected lookup as uncertain too, leaving the key resendable", async () => {
    const user = await toReview({ confirm: transportFailure, lookup: transportFailure });

    await user.click(screen.getByRole("button", { name: t("forms.publish.wizardConfirm") }));
    await screen.findByTestId("qcms-publish-uncertain");
    await user.click(screen.getByRole("button", { name: t("forms.publish.lookup") }));

    expect(await screen.findByTestId("qcms-publish-uncertain")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("forms.publish.lookup") })).toBeTruthy();
  });
});
