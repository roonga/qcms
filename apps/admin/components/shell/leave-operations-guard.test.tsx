import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEAVE_EXEMPT_ATTRIBUTE } from "../../lib/shell/leave-operations.ts";

import { LeaveOperationsGuard } from "./leave-operations-guard.tsx";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function page(environment = "prod") {
  return render(
    <>
      <a href="/forms/frm_a/versions">Versions</a>
      <a href="/operations/forms/frm_a/links">Links</a>
      <a href="/settings">Settings</a>
      <a href="/questions" {...{ [LEAVE_EXEMPT_ATTRIBUTE]: "" }}>
        Exit Operations
      </a>
      <a href="/questions" target="_blank">
        New tab
      </a>
      <LeaveOperationsGuard environment={environment} />
    </>,
  );
}

/** Counts the clicks that got past the guard, the way the browser or Next would see them. */
let passed = 0;
function countPassed(event: MouseEvent): void {
  if (!event.defaultPrevented) passed += 1;
  event.preventDefault();
}
const seen = { count: () => passed };

afterEach(() => {
  document.removeEventListener("click", countPassed);
});

beforeEach(() => {
  passed = 0;
  document.addEventListener("click", countPassed);
  push.mockReset();
  window.history.replaceState(null, "", "/operations");
});

describe("the leave-Operations warning", () => {
  it("stops a link out of Operations and says where it goes", async () => {
    const user = userEvent.setup();
    page();
    const before = seen.count();
    await user.click(screen.getByRole("link", { name: "Versions" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("This link opens Forms, outside Operations.");
    expect(dialog.textContent).toContain("The prod environment you selected in Operations");
    expect(seen.count()).toBe(before);
    expect(push).not.toHaveBeenCalled();
  });

  it("puts focus on Stay, and Stay keeps the operator where they are", async () => {
    const user = userEvent.setup();
    page();
    const link = screen.getByRole("link", { name: "Versions" });
    await user.click(link);

    const stay = await screen.findByRole("button", { name: "Stay in Operations" });
    await waitFor(() => {
      expect(document.activeElement).toBe(stay);
    });
    await user.click(stay);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(link);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("treats Escape as Stay", async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole("link", { name: "Versions" }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("goes on Leave", async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole("link", { name: "Versions" }));
    await user.click(await screen.findByRole("button", { name: "Leave" }));

    expect(push).toHaveBeenCalledWith("/forms/frm_a/versions");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("shows nothing for movement inside Operations, the personal routes, Exit or a new tab", async () => {
    const user = userEvent.setup();
    page();
    for (const name of ["Links", "Settings", "Exit Operations", "New tab"]) {
      const before = seen.count();
      await user.click(screen.getByRole("link", { name }));
      expect(screen.queryByRole("alertdialog"), name).toBeNull();
      expect(seen.count(), name).toBe(before + 1);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("does not name an environment it does not know", async () => {
    const user = userEvent.setup();
    page("");
    await user.click(screen.getByRole("link", { name: "Versions" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "The environment you selected in Operations does not apply there.",
    );
  });

  it("stops listening once Operations is left", async () => {
    const user = userEvent.setup();
    const { unmount } = page();
    act(() => {
      unmount();
    });
    render(<a href="/forms">Forms</a>);
    const before = seen.count();
    await user.click(screen.getByRole("link", { name: "Forms" }));
    expect(seen.count()).toBe(before + 1);
  });
});
