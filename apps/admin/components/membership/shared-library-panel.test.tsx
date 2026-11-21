import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";

import { SharedLibraryPanel } from "./shared-library-panel";

const WORKSPACES = [
  { workspaceId: "org_library", name: "Question library" },
  { workspaceId: "org_finance", name: "Finance" },
];

function isOff(button: HTMLElement): boolean {
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

describe("the shared question library screen (criterion 109)", () => {
  it("states who will see the questions before the marking is saved", async () => {
    const save = vi.fn().mockResolvedValue({ status: "done", message: t("site.library.saved") });
    render(<SharedLibraryPanel workspaces={WORKSPACES} holder={null} save={save} />);

    expect(isOff(screen.getAllByRole("button", { name: t("site.library.save") })[0]!)).toBe(true);

    await userEvent.click(screen.getByRole("radio", { name: "Question library" }));
    await userEvent.click(screen.getAllByRole("button", { name: t("site.library.save") })[0]!);

    const confirm = screen.getByTestId("qcms-shared-library-confirm");
    expect(confirm.textContent).toContain(
      "Everyone with Edit forms in any workspace will be able to see and pin Question library's questions.",
    );
    expect(confirm.textContent).toContain(
      "Recorded in the site audit and in Question library's audit.",
    );

    await userEvent.click(within(confirm).getByRole("button", { name: t("site.library.save") }));
    expect(save).toHaveBeenCalledWith({ workspaceId: "org_library", holder: null });
    expect(await screen.findByText(t("site.library.saved"))).not.toBeNull();
  });

  it("unmarks through None, saying what stops and what stays", async () => {
    const save = vi.fn().mockResolvedValue({ status: "done", message: t("site.library.saved") });
    render(<SharedLibraryPanel workspaces={WORKSPACES} holder="org_library" save={save} />);

    await userEvent.click(screen.getByRole("radio", { name: t("site.library.none") }));
    await userEvent.click(screen.getAllByRole("button", { name: t("site.library.save") })[0]!);

    const confirm = screen.getByTestId("qcms-shared-library-confirm");
    expect(confirm.textContent).toContain(t("site.library.confirmUnmark"));
    await userEvent.click(within(confirm).getByRole("button", { name: t("site.library.save") }));
    expect(save).toHaveBeenCalledWith({ workspaceId: null, holder: "org_library" });
  });

  it("says a library matters at two or more workspaces", () => {
    render(<SharedLibraryPanel workspaces={[WORKSPACES[0]!]} holder={null} save={vi.fn()} />);
    expect(screen.getByTestId("qcms-shared-library").textContent).toContain(
      t("site.library.oneWorkspace"),
    );
  });
});
