import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FormActions } from "./form-actions.tsx";
import { PublishWizard } from "./publish-wizard.tsx";
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
  it("offers one way to publish, and it is the wizard", () => {
    render(
      <FormActions
        formId="frm_intake"
        slug="intake"
        status="open"
        workflow={WORKFLOW}
        environment="test"
        setStatus={() => Promise.resolve({ status: "idle" })}
      />,
    );
    // No dialog of its own at all (Code Owner, 2026-10-31): one entry, and it is a link.
    expect(screen.queryByRole("button", { name: /Publish/u })).toBeNull();
    expect(
      screen.getByRole("link", { name: t("forms.versions.publishEntry") }).getAttribute("href"),
    ).toBe("/forms/frm_intake/publish");
  });

  it("explains missing publishing permission instead of offering the entry", () => {
    render(
      <FormActions
        formId="frm_intake"
        slug="intake"
        status="open"
        workflow={{ ...WORKFLOW, canPublish: false }}
        environment="test"
        setStatus={() => Promise.resolve({ status: "idle" })}
      />,
    );
    // Gated rather than disabled: a caller who may not publish is offered no way to.
    expect(screen.queryByRole("link", { name: t("forms.versions.publishEntry") })).toBeNull();
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
    expect(within(dialog).getByTestId("qcms-release-replacement").textContent).toContain(
      "v2 will replace v1 in prod.",
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
    // The gate moved to the wizard's source step with the dialogs (Code Owner,
    // 2026-10-31): a seeded draft is not stored, so there is nothing to freeze and the
    // draft source says so rather than being silently unavailable.
    render(
      <PublishWizard
        formId="frm_intake"
        versions={[1]}
        hasDraft={false}
        canPublishDraft
        draft={DRAFT}
        review={() => Promise.resolve({ ok: false })}
        confirm={() => Promise.resolve({ status: "idle" })}
        lookup={() => Promise.resolve({ status: "idle" })}
      />,
    );
    expect(
      screen
        .getByRole("radio", { name: new RegExp(t("forms.publish.source.draft"), "u") })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(t("forms.publish.source.noDraft"))).toBeTruthy();
  });
});
