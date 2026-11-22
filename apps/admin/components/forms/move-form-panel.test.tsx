import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";
import type { MovePreview } from "@/lib/forms/move";

import { MoveFormPanel } from "./move-form-panel";

const DESTINATIONS = [
  { workspaceId: "org_finance", name: "Finance" },
  { workspaceId: "org_people", name: "People" },
];

const CHOSEN = DESTINATIONS[0]!;

function preview(over: Partial<MovePreview> = {}): MovePreview {
  return {
    formId: "frm_intake",
    sourceWorkspaceId: "org_clinical",
    destinationWorkspaceId: "org_finance",
    requiresApproval: false,
    holdReason: null,
    gains: [
      {
        name: "Priya Shah",
        acts: [{ act: "response.read", environments: ["prod"] }],
      },
    ],
    losses: [
      {
        name: "Grace Mensah",
        acts: [{ act: "form.write", environments: [] }],
      },
    ],
    ...over,
  };
}

describe("the Move form screen's preview (criterion 101)", () => {
  it("names who gains and who loses before anything is confirmed", () => {
    render(
      <MoveFormPanel
        formId="frm_intake"
        source="Clinical"
        destinations={DESTINATIONS}
        chosen={CHOSEN}
        preview={preview()}
        move={vi.fn()}
      />,
    );

    expect(screen.getByTestId("qcms-move-gains").textContent).toContain("Priya Shah");
    expect(screen.getByTestId("qcms-move-gains").textContent).toContain(
      "Read responses in Production",
    );
    expect(screen.getByTestId("qcms-move-losses").textContent).toContain("Grace Mensah");
    expect(screen.getByTestId("qcms-move-form").textContent).toContain(
      "This form moves from Clinical to Finance",
    );
    expect(screen.queryByTestId("qcms-move-approval")).toBeNull();
    expect(
      screen.getByRole("button", { name: t("forms.move.confirm", { destination: "Finance" }) }),
    ).not.toBeNull();
  });

  it("says who can approve a held move, and asks for one instead of moving", async () => {
    const move = vi.fn().mockResolvedValue({ status: "held", message: t("forms.move.held") });
    render(
      <MoveFormPanel
        formId="frm_intake"
        source="Clinical"
        destinations={DESTINATIONS}
        chosen={CHOSEN}
        preview={preview({ requiresApproval: true, holdReason: "second-approval" })}
        move={move}
      />,
    );

    const approval = screen.getByTestId("qcms-move-approval");
    expect(approval.textContent).toContain("Second approval is on in Clinical");
    expect(approval.textContent).toContain(
      "a Workspace administrator of Clinical or a Site administrator",
    );

    await userEvent.click(screen.getByRole("button", { name: t("forms.move.request") }));
    expect(move).toHaveBeenCalledWith("frm_intake", CHOSEN);
    expect(await screen.findByText(t("forms.move.held"))).not.toBeNull();
  });

  it("says why the move waits when the mover does not administer the source", () => {
    render(
      <MoveFormPanel
        formId="frm_intake"
        source="Clinical"
        destinations={DESTINATIONS}
        chosen={CHOSEN}
        preview={preview({ requiresApproval: true, holdReason: "not-source-administrator" })}
        move={vi.fn()}
      />,
    );

    expect(screen.getByTestId("qcms-move-approval").textContent).toContain(
      "You are not a Workspace administrator of Clinical",
    );
  });

  it("offers no move at all where there is no other workspace to move to", () => {
    render(
      <MoveFormPanel formId="frm_intake" source="Clinical" destinations={[]} move={vi.fn()} />,
    );

    expect(screen.getByTestId("qcms-move-form").textContent).toContain(t("forms.move.nowhere"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for a destination before showing any preview", () => {
    render(
      <MoveFormPanel
        formId="frm_intake"
        source="Clinical"
        destinations={DESTINATIONS}
        move={vi.fn()}
      />,
    );

    expect(screen.getByTestId("qcms-move-form").textContent).toContain(t("forms.move.choose"));
    expect(screen.queryByTestId("qcms-move-preview")).toBeNull();
  });
});
