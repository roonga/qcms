import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShellChrome } from "./shell-chrome.tsx";
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
      trailing={<span>tools</span>}
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
