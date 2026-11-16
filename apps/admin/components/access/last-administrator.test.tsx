import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";
import { NO_ACCESS_CAPABILITIES, type AccessCapabilities } from "@/lib/membership/access-patterns";

import { AdministratorRemoval } from "./last-administrator";

const WORKSPACE_ADMIN: AccessCapabilities = new Set(["administrators.manage"]);
const SITE_ADMIN: AccessCapabilities = new Set(["siteAdministrators.manage"]);

function isOff(button: HTMLElement): boolean {
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

describe("the last-administrator control", () => {
  it("disables Remove for the last Workspace administrator, with the reason and a way to appoint", () => {
    const onPress = vi.fn();
    render(
      <AdministratorRemoval
        scope="workspace"
        person="Grace Mensah"
        workspace="Clinical"
        isLast
        capabilities={WORKSPACE_ADMIN}
        appointHref="/workspaces/ws_1/members"
        onPress={onPress}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Remove Workspace administrator, Grace Mensah",
    });
    expect(isOff(button)).toBe(true);
    expect(button.textContent).toContain(t("access.lastAdmin.remove"));
    expect(
      screen.getByText("Grace Mensah is the last Workspace administrator of Clinical."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: t("access.lastAdmin.appointWorkspace") })
        .getAttribute("href"),
    ).toBe("/workspaces/ws_1/members");
  });

  it("disables Demote for the last active Site administrator", () => {
    render(
      <AdministratorRemoval
        scope="site"
        person="Sam Okafor"
        isLast
        capabilities={SITE_ADMIN}
        onPress={vi.fn()}
      />,
    );
    const demote = screen.getByRole("button", { name: "Demote, Sam Okafor" });
    expect(isOff(demote)).toBe(true);
    expect(demote.getAttribute("aria-label") ?? demote.textContent).toContain(
      t("access.lastAdmin.demote"),
    );
    expect(screen.getByText("Sam Okafor is the last active Site administrator.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers Promote another Site administrator to the last Site administrator", () => {
    render(
      <AdministratorRemoval
        scope="site"
        person="Sam Okafor"
        isLast
        capabilities={SITE_ADMIN}
        appointHref="/site/administrators"
        onPress={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: "Promote another Site administrator" });
    expect(link.getAttribute("href")).toBe("/site/administrators");
  });

  it("starts every accessible name with the visible label (WCAG 2.5.3)", () => {
    render(
      <>
        <AdministratorRemoval
          scope="workspace"
          person="Grace Mensah"
          workspace="Clinical"
          isLast={false}
          capabilities={WORKSPACE_ADMIN}
          onPress={vi.fn()}
        />
        <AdministratorRemoval
          scope="site"
          person="Sam Okafor"
          isLast={false}
          capabilities={SITE_ADMIN}
          onPress={vi.fn()}
        />
      </>,
    );
    const remove = screen.getByRole("button", { name: /^Remove/ });
    const demote = screen.getByRole("button", { name: /^Demote/ });
    expect(remove.getAttribute("aria-label") ?? remove.textContent).toContain(
      t("access.lastAdmin.remove"),
    );
    expect(demote.getAttribute("aria-label") ?? demote.textContent).toContain(
      t("access.lastAdmin.demote"),
    );
  });

  it("acts, with no reason shown, while another administrator remains", async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <AdministratorRemoval
        scope="site"
        person="Luis Ortega"
        isLast={false}
        capabilities={SITE_ADMIN}
        appointHref="/site/administrators"
        onPress={onPress}
      />,
    );
    const button = screen.getByRole("button", { name: "Demote, Luis Ortega" });
    expect(isOff(button)).toBe(false);
    expect(screen.queryByRole("link")).toBeNull();
    button.focus();
    await user.keyboard("{Enter}");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders no control for a caller who cannot appoint or remove administrators", () => {
    const { container } = render(
      <>
        <AdministratorRemoval
          scope="workspace"
          person="Grace Mensah"
          workspace="Clinical"
          isLast
          capabilities={NO_ACCESS_CAPABILITIES}
          appointHref="/workspaces/ws_1/members"
          onPress={vi.fn()}
        />
        <AdministratorRemoval
          scope="site"
          person="Sam Okafor"
          isLast={false}
          capabilities={WORKSPACE_ADMIN}
          onPress={vi.fn()}
        />
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("hides the promote link from a caller without siteAdministrators.manage", () => {
    render(
      <AdministratorRemoval
        scope="site"
        person="Sam Okafor"
        isLast
        capabilities={WORKSPACE_ADMIN}
        appointHref="/site/administrators"
        onPress={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
