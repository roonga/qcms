import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FormActions } from "./form-actions.tsx";
import { ReleasePanel } from "./release-panel.tsx";
import type { FormPublishingWorkflow } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";

const WORKFLOW: FormPublishingWorkflow = {
  enabled: true,
  environment: "test",
  canEdit: true,
  canPublish: true,
  canRelease: true,
  eligibleVersions: [2, 1],
  preferredVersion: 2,
  currentVersion: 1,
};
const DRAFT = {
  formId: "frm_intake",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [{ stepId: "step_details", title: { en: "Details" }, items: [] }],
  rules: [],
};

describe("environment-bound publishing", () => {
  it("offers one publish action which publishes and releases to test together", async () => {
    const user = userEvent.setup();
    const publish = vi.fn();
    const combined = vi
      .fn()
      .mockResolvedValue({ status: "released", version: 1, environment: "test" });
    render(
      <FormActions
        formId="frm_intake"
        slug="intake"
        draft={DRAFT}
        status="open"
        latestVersion={undefined}
        workflow={WORKFLOW}
        environment="test"
        publish={publish}
        publishAndRelease={combined}
        setStatus={() => Promise.resolve({ status: "idle" })}
      />,
    );
    expect(screen.queryByRole("button", { name: t("forms.publish.action") })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Publish to test" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Create v1 and release it to test?");
    await user.click(within(dialog).getByRole("button", { name: "Publish to test" }));
    await screen.findByText("Published as v1 and released to test.");
    expect(combined).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: t("forms.tab.links") }).getAttribute("href")).toBe(
      "/forms/frm_intake/links",
    );
  });

  it("announces a rejected combined publish while keeping the issue work list outside the live region", async () => {
    const user = userEvent.setup();
    render(
      <FormActions
        formId="frm_intake"
        slug="intake"
        draft={DRAFT}
        status="open"
        latestVersion={undefined}
        workflow={WORKFLOW}
        environment="test"
        publish={() => Promise.resolve({ status: "idle" })}
        publishAndRelease={() =>
          Promise.resolve({
            status: "rejected",
            issues: [
              {
                code: "RULE_BACKWARD_TARGET",
                message: "Fix the rule placement",
                path: { step: "step_details" },
              },
            ],
          })
        }
        setStatus={() => Promise.resolve({ status: "idle" })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Publish to test" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Publish to test",
      }),
    );
    const status = screen.getByTestId("qcms-form-actions-status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Publish blocked");
    expect(within(status).queryByTestId("qcms-publish-rejected")).toBeNull();
    expect(await screen.findByTestId("qcms-publish-rejected")).toBeTruthy();
  });

  it("explains missing publishing permission before the operator acts", () => {
    render(
      <FormActions
        formId="frm_intake"
        slug="intake"
        draft={DRAFT}
        status="open"
        latestVersion={undefined}
        workflow={{ ...WORKFLOW, canPublish: false }}
        environment="test"
        publish={() => Promise.resolve({ status: "idle" })}
        publishAndRelease={() => Promise.resolve({ status: "idle" })}
        setStatus={() => Promise.resolve({ status: "idle" })}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish to test" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      screen.getByText(t("forms.workflow.noPublishPermission", { environment: "test" })),
    ).toBeTruthy();
  });

  it("locks a test release to test even when production exists", async () => {
    const user = userEvent.setup();
    render(
      <ReleasePanel
        formId="frm_intake"
        releases={[]}
        versions={[3, 2, 1]}
        environments={["test", "prod"]}
        selectedEnvironment="test"
        workflow={WORKFLOW}
        twoPerson={{ required: false, viewer: "author", authorOf: {} }}
        release={() => Promise.resolve({ status: "idle" })}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("button", { name: /Environment$/u })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Release v2 to prod" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Release v2 to test" })).toBeTruthy();
  });

  it("promotes the preferred tested version, excluding a newer untested version", async () => {
    const user = userEvent.setup();
    const release = vi
      .fn()
      .mockResolvedValue({ status: "released", version: 2, environment: "prod" });
    render(
      <ReleasePanel
        formId="frm_intake"
        releases={[]}
        versions={[3, 2, 1]}
        environments={["test", "prod"]}
        selectedEnvironment="prod"
        workflow={{ ...WORKFLOW, environment: "prod", canEdit: false, canPublish: false }}
        twoPerson={{ required: false, viewer: "approver", authorOf: {} }}
        release={release}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("link", { name: "Review v2" }).getAttribute("href")).toBe(
      "/forms/frm_intake/versions/2",
    );
    await user.click(within(dialog).getByRole("button", { name: /Version to release$/u }));
    expect(screen.queryByRole("option", { name: "v3" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "v2" }));
    await user.click(within(dialog).getByRole("button", { name: "Release v2 to prod" }));
    await screen.findByText("v2 is now released to prod.");
    expect(release).toHaveBeenCalledWith({ version: 2 });
  });
});

describe("release confirmations across environment changes", () => {
  it("closes an existing confirmation when the refreshed environment changes", async () => {
    const user = userEvent.setup();
    const release = vi.fn();
    const props = {
      formId: "frm_intake",
      releases: [],
      versions: [2, 1],
      environments: ["test", "prod"],
      selectedEnvironment: "test",
      workflow: WORKFLOW,
      twoPerson: { required: false, viewer: "approver", authorOf: {} },
      release,
    };
    const view = render(<ReleasePanel {...props} />);
    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    await screen.findByRole("alertdialog");
    view.rerender(
      <ReleasePanel
        {...props}
        selectedEnvironment="prod"
        workflow={{ ...WORKFLOW, environment: "prod" }}
      />,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(release).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Release v2 to prod" })).toBeTruthy();
  });

  it("does not offer to publish an unchanged seed as another version", () => {
    render(
      <FormActions
        formId="frm_intake"
        slug="intake"
        draft={DRAFT}
        status="open"
        latestVersion={1}
        hasStoredDraft={false}
        workflow={WORKFLOW}
        environment="test"
        publish={() => Promise.resolve({ status: "idle" })}
        publishAndRelease={() => Promise.resolve({ status: "idle" })}
        setStatus={() => Promise.resolve({ status: "idle" })}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish to test" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByText(t("forms.workflow.noChanges"))).toBeTruthy();
  });
});
