import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MembershipActionState } from "@/lib/membership/types";

import { ArchivePanel } from "./archive-panel";

const DONE: MembershipActionState = { status: "done", message: "ok" };
const NAME = "Finance";

interface Options {
  readonly forms?: number | undefined;
  readonly isShared?: boolean | undefined;
  readonly archived?: boolean;
  readonly answer?: MembershipActionState;
}

function renderPanel(options: Options = {}) {
  const archive = vi.fn(() => Promise.resolve(options.answer ?? DONE));
  render(
    <ArchivePanel
      workspaceId="ws_1"
      name={NAME}
      forms={options.forms ?? 0}
      isShared={options.isShared ?? false}
      archived={options.archived ?? false}
      archive={archive}
    />,
  );
  return archive;
}

/* This project carries no jest-dom, so a disabled control is read off the element itself. */
function isOff(element: Element): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

function actButton() {
  return screen.getByRole("button", { name: `Archive ${NAME}` });
}

describe("the archive screen", () => {
  it("keeps the act off until the name is typed exactly", async () => {
    const archive = renderPanel();
    const user = userEvent.setup();
    expect(screen.getByText("Archiving Finance cannot be undone.")).toBeTruthy();
    expect(isOff(actButton())).toBe(true);
    await user.type(screen.getByLabelText(`Type ${NAME} to confirm`), "Fin");
    expect(isOff(actButton())).toBe(true);
    expect(screen.getAllByText("Type Finance exactly.").length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText(`Type ${NAME} to confirm`), "ance");
    expect(isOff(actButton())).toBe(false);
    await user.click(actButton());
    expect(archive).toHaveBeenCalledWith("ws_1");
  });

  it("refuses inline while forms remain, and offers the way to move them", () => {
    renderPanel({ forms: 3 });
    const blockers = screen.getByTestId("qcms-archive-blockers");
    expect(blockers.textContent).toContain("Cannot archive yet");
    expect(blockers.textContent).toContain("3 forms are still in this workspace");
    expect(blockers.textContent).toContain("closed and never-published ones included");
    expect(screen.getByRole("link", { name: "Open Forms" })).toBeTruthy();
    expect(isOff(actButton())).toBe(true);
    expect(isOff(screen.getByLabelText(`Type ${NAME} to confirm`))).toBe(true);
  });

  it("counts one remaining form in the singular", () => {
    renderPanel({ forms: 1 });
    expect(screen.getByTestId("qcms-archive-blockers").textContent).toContain(
      "1 form is still in this workspace",
    );
  });

  it("refuses while the workspace is the shared question library", () => {
    renderPanel({ isShared: true });
    expect(screen.getByTestId("qcms-archive-blockers").textContent).toContain(
      "This is the shared question library.",
    );
    expect(isOff(actButton())).toBe(true);
  });

  it("leaves the refusal to the API where the caller was sent no counts", () => {
    renderPanel({ forms: undefined, isShared: undefined });
    expect(screen.queryByTestId("qcms-archive-blockers")).toBeNull();
    expect(isOff(actButton())).toBe(true);
  });

  it("offers no act on a workspace already archived, and no unarchive", () => {
    renderPanel({ archived: true });
    expect(screen.getByText("This workspace is archived. There is no unarchive.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Archive ${NAME}` })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says what the archive did once it is done", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(`Type ${NAME} to confirm`), NAME);
    await user.click(actButton());
    expect(
      await screen.findByText(
        "Finance is archived. Nothing was deleted, and there is no unarchive.",
      ),
    ).toBeTruthy();
  });

  it("reports the API's refusal", async () => {
    renderPanel({ answer: { status: "error", message: "still has forms" } });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(`Type ${NAME} to confirm`), NAME);
    await user.click(actButton());
    expect(await screen.findByText("still has forms")).toBeTruthy();
  });
});
