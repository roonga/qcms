import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PublishWizard } from "./publish-wizard.tsx";
import type { ReleaseReview } from "../../lib/forms/release-candidate.ts";
import { environmentLabel } from "../../lib/environment.ts";
import { t } from "../../lib/i18n/en.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function review(heldForApproval: boolean): ReleaseReview {
  return {
    source: { kind: "draft", draftRevision: 3 },
    workflowRevision: null,
    workflowSource: "default",
    productionFloor: false,
    targets: [
      {
        environment: "prod",
        currentVersion: 4,
        currentSequence: 2,
        closed: false,
        evidence: [],
        blockers: [],
        twoPerson: { applies: true, refusedAsAuthor: false, heldForApproval },
        protected: true,
      },
    ],
  };
}

async function toReview(heldForApproval: boolean, confirm = vi.fn()) {
  const user = userEvent.setup();
  render(
    <PublishWizard
      formId="frm_intake"
      versions={[4]}
      hasDraft
      canPublishDraft
      draft={null}
      review={() => Promise.resolve({ ok: true, data: review(heldForApproval) })}
      confirm={confirm}
      lookup={() => Promise.resolve({ status: "idle" })}
      secureCookies={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
  await user.click(await screen.findByRole("checkbox", { name: "prod" }));
  await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
  return user;
}

describe("a draft publish held for an Approver", () => {
  it("names the request on the last step, and says nothing is frozen", async () => {
    await toReview(true);
    expect(screen.getByText("Publish draft to Production")).toBeTruthy();
    expect(
      screen.getByText(
        t("forms.publish.held.requestNote", { environment: environmentLabel("prod") }),
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("qcms-publish-second-person")).toBeNull();
    expect(screen.getByRole("button", { name: "Request publish to Production" })).toBeTruthy();
  });

  it("shows the request waiting once asked, and offers no second ask", async () => {
    const confirm = vi.fn(() => Promise.resolve({ status: "held" as const }));
    const user = await toReview(true, confirm);
    await user.click(screen.getByRole("button", { name: "Request publish to Production" }));
    expect(await screen.findByText(t("forms.publish.held.waiting"))).toBeTruthy();
    expect(screen.getByText("Expires in 7 days.")).toBeTruthy();
    expect(screen.getByText(t("forms.publish.held"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request publish to Production" })).toBeNull();
  });

  it("names the environment on an ordinary confirmation", async () => {
    await toReview(false);
    expect(screen.getByRole("button", { name: "Publish to Production" })).toBeTruthy();
    expect(screen.queryByTestId("qcms-publish-held-request")).toBeNull();
  });
});
