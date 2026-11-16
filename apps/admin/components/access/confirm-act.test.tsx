import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";
import { accessDelta, type GroupGrant } from "@/lib/membership/access-patterns";

import { AccessPreview } from "./access-preview";
import { ConfirmAct } from "./confirm-act";

const AUTHORS: GroupGrant = {
  id: "tm_authors",
  name: "Authors",
  roles: ["forms.editor", "forms.publisher", "responses.viewer"],
  environments: ["test"],
};
const REVIEWERS: GroupGrant = {
  id: "tm_reviewers",
  name: "Reviewers",
  roles: ["forms.viewer"],
  environments: [],
};
const RESPONSE_VIEWERS: GroupGrant = {
  id: "tm_rv",
  name: "Response viewers",
  roles: ["responses.viewer"],
  environments: ["prod"],
};
const ENVIRONMENTS = ["test", "prod"];

function isOff(button: HTMLElement): boolean {
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

describe("preview before confirming", () => {
  it("adding yourself under second approval shows the gain, the Approver and a request button", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmAct
        title="Add yourself to Response viewers?"
        act="Add to Response viewers"
        level={{ kind: "plain" }}
        needsApproval
        preview={
          <AccessPreview
            delta={accessDelta([], [RESPONSE_VIEWERS], ENVIRONMENTS)}
            approval={{
              reason: "Second approval is on and you are adding yourself.",
              approvers: "Grace Mensah, Sam Okafor",
            }}
          />
        }
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add yourself to Response viewers?" });
    const preview = within(dialog).getByTestId("qcms-access-preview");
    expect(preview.textContent).toContain(t("access.preview.gains"));
    expect(preview.textContent).toContain("View responses in prod");
    expect(preview.textContent).not.toContain(t("access.preview.loses"));

    const approval = within(dialog).getByTestId("qcms-access-approval");
    expect(approval.textContent).toContain(t("access.preview.needsApprover"));
    expect(approval.textContent).toContain("Second approval is on and you are adding yourself.");
    expect(approval.textContent).toContain("Who can approve: Grace Mensah, Sam Okafor");

    expect(within(dialog).queryByRole("button", { name: "Add to Response viewers" })).toBeNull();
    within(dialog)
      .getByRole("button", { name: t("access.preview.requestApproval") })
      .click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("removing someone from a group shows what they lose and keep, on a button naming the act", () => {
    render(
      <ConfirmAct
        title="Remove Priya Shah from Authors?"
        act="Remove from Authors"
        level={{ kind: "plain" }}
        tone="danger"
        preview={
          <AccessPreview delta={accessDelta([AUTHORS, REVIEWERS], [REVIEWERS], ENVIRONMENTS)} />
        }
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Remove Priya Shah from Authors?" });
    const items = within(dialog)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "Edit forms",
      "Publish forms in test",
      "View responses in test",
      "View forms through Reviewers",
    ]);
    expect(within(dialog).queryByTestId("qcms-access-approval")).toBeNull();
    expect(isOff(within(dialog).getByRole("button", { name: "Remove from Authors" }))).toBe(false);
  });

  it("says so when nothing changes", () => {
    render(<AccessPreview delta={accessDelta([REVIEWERS], [REVIEWERS], ENVIRONMENTS)} />);
    expect(screen.getByText(t("access.preview.noChange"))).toBeTruthy();
  });
});

describe("confirmation levels", () => {
  it("a plain confirm acts on one press", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAct
        title="Grant Response viewers?"
        act="Add to Response viewers"
        level={{ kind: "plain" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add to Response viewers" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("a typed confirm stays off until the name is typed exactly", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAct
        title="Erase 12 responses?"
        act="Erase 12 responses"
        level={{ kind: "typed", name: "Patient intake" }}
        tone="danger"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Erase 12 responses?" });
    const confirm = within(dialog).getByRole("button", { name: "Erase 12 responses" });
    const box = within(dialog).getByRole("textbox", { name: "Type Patient intake to confirm" });
    expect(isOff(confirm)).toBe(true);

    await user.type(box, "Patient");
    expect(isOff(confirm)).toBe(true);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    const describedBy = (box.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(describedBy).toContain(t("access.confirm.typedMismatch", { name: "Patient intake" }));

    await user.type(box, " intake");
    expect(box.getAttribute("aria-invalid")).toBeNull();
    expect(isOff(confirm)).toBe(false);
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("is working while pending and announces a refusal", () => {
    render(
      <ConfirmAct
        title="Archive Clinical?"
        act="Archive Clinical"
        level={{ kind: "typed", name: "Clinical" }}
        tone="danger"
        pending
        error="The workspace still holds forms."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(isOff(within(dialog).getByRole("button", { name: t("access.confirm.working") }))).toBe(
      true,
    );
    expect(isOff(within(dialog).getByRole("button", { name: t("access.confirm.cancel") }))).toBe(
      true,
    );
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "The workspace still holds forms.",
    );
  });

  it("is keyboard reachable: Tab walks the field and buttons, and Escape cancels", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmAct
        title="Erase 12 responses?"
        act="Erase 12 responses"
        level={{ kind: "typed", name: "Patient intake" }}
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Type Patient intake to confirm" });
    box.focus();
    await user.keyboard("Patient intake");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erase 12 responses" }));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: t("access.confirm.cancel") }),
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
});
