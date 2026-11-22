import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShellChrome } from "./shell-chrome.tsx";
import { t } from "../../lib/i18n/en.ts";
import { BUILDER_RETURN_KEY } from "../../lib/forms/build-return.ts";
import { setBuilderSubjectName } from "../../lib/shell/builder-subject.ts";
import { OPERATIONS_RETURN_KEY } from "../../lib/shell/leave-operations.ts";
import type { ShellCapabilities } from "../../lib/shell/modes.ts";

const location = vi.hoisted(() => ({ pathname: "/questions", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const EVERYTHING: ShellCapabilities = {
  authoring: true,
  operations: true,
  workspaces: true,
  siteConfiguration: true,
};

function chrome(multipleWorkspaces = true) {
  return (
    <ShellChrome
      capabilities={EVERYTHING}
      rememberedMode={undefined}
      secureCookies={false}
      environment={<span data-testid="qcms-environment-switcher">test</span>}
      environmentName="test"
      trailing={<span data-testid="qcms-tools-stub">tools</span>}
      workspace={<span data-testid="qcms-workspace-switcher">Default</span>}
      multipleWorkspaces={multipleWorkspaces}
    />
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  location.pathname = "/questions";
  location.search = "";
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("the top bar", () => {
  it("folds Operations, the environment and Exit into one group in Operations only", () => {
    const view = render(chrome());
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.queryByTestId("qcms-mode-header")).toBeNull();
    expect(screen.queryByTestId("qcms-mode-exit")).toBeNull();

    location.pathname = "/operations";
    view.rerender(chrome());
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByTestId("qcms-mode-header").getAttribute("data-mode")).toBe("operations");
    expect(screen.getByTestId("qcms-mode-exit")).toBeTruthy();
  });

  it("names the area in the singular when the caller may open one workspace", () => {
    const view = render(chrome());
    expect(screen.getByRole("link", { name: "Workspaces" })).toBeTruthy();

    view.rerender(chrome(false));
    expect(screen.getByRole("link", { name: "Workspace" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Workspaces" })).toBeNull();
  });

  it("remembers a query-only change outside Operations for Exit to return to", () => {
    const view = render(chrome());
    expect(window.sessionStorage.getItem(OPERATIONS_RETURN_KEY)).toBe("/questions");

    location.search = "q=age";
    view.rerender(chrome());
    expect(window.sessionStorage.getItem(OPERATIONS_RETURN_KEY)).toBe("/questions?q=age");

    location.pathname = "/operations";
    location.search = "";
    view.rerender(chrome());
    expect(screen.getByTestId("qcms-mode-exit").getAttribute("href")).toBe("/questions?q=age");
  });
});

describe("the assistant mode's top bar group", () => {
  it("replaces the navigation with the title, the form's name and Exit, with no environment", () => {
    location.pathname = "/forms/frm_a/build";
    render(chrome());
    act(() => {
      setBuilderSubjectName("Patient intake");
    });
    const group = screen.getByRole("group", { name: t("shell.mode.builder.name") });
    expect(group.getAttribute("data-mode")).toBe("builder");
    expect(screen.getByTestId("qcms-builder-subject").textContent).toBe("Patient intake");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByTestId("qcms-environment-switcher")).toBeNull();
    const exit = screen.getByRole("link", { name: t("shell.mode.builder.exit") });
    expect(exit.textContent).toBe("Exit");
    act(() => {
      setBuilderSubjectName("");
    });
  });

  it("shows the builder group alone, with no workspace switcher, theme toggle or account menu", () => {
    const view = render(chrome());
    expect(screen.getByTestId("qcms-workspace-switcher")).toBeTruthy();
    expect(screen.getByTestId("qcms-tools-stub")).toBeTruthy();

    location.pathname = "/forms/frm_a/build";
    view.rerender(chrome());
    expect(screen.getByRole("group", { name: t("shell.mode.builder.name") })).toBeTruthy();
    expect(screen.queryByTestId("qcms-workspace-switcher")).toBeNull();
    expect(screen.queryByTestId("qcms-tools-stub")).toBeNull();
    expect(view.container.querySelector(".qcms-topbar__tools")).toBeNull();
  });

  it("names a new form and exits to the New form screen", () => {
    location.pathname = "/forms/new/build";
    render(chrome());
    expect(screen.getByTestId("qcms-builder-subject").textContent).toBe("New form");
    expect(screen.getByTestId("qcms-mode-exit").getAttribute("href")).toBe("/forms/new");
  });

  it("exits to the list it was entered from, recorded in this tab", () => {
    location.pathname = "/forms";
    location.search = "status=open";
    const view = render(chrome());
    expect(window.sessionStorage.getItem(BUILDER_RETURN_KEY)).toBe("/forms?status=open");

    location.pathname = "/forms/frm_a/build";
    location.search = "";
    view.rerender(chrome());
    expect(screen.getByTestId("qcms-mode-exit").getAttribute("href")).toBe("/forms?status=open");
  });

  it("exits to the form page when the recorded address is not an entry point", () => {
    window.sessionStorage.setItem(BUILDER_RETURN_KEY, "/questions");
    location.pathname = "/forms/frm_a/build";
    render(chrome());
    expect(screen.getByTestId("qcms-mode-exit").getAttribute("href")).toBe("/forms/frm_a");
  });
});
