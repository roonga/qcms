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

function chrome() {
  return (
    <ShellChrome
      capabilities={EVERYTHING}
      rememberedMode={undefined}
      secureCookies={false}
      environment={<span data-testid="qcms-environment-switcher">test</span>}
      environmentName="test"
      trailing={<span>tools</span>}
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
  it("keeps the application navigation and both reserved slots in every area", () => {
    const view = render(chrome());
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(view.container.querySelector(".qcms-topbar__exit")).not.toBeNull();
    expect(view.container.querySelector(".qcms-topbar__env")).not.toBeNull();
    expect(screen.queryByTestId("qcms-mode-header")).toBeNull();
    expect(screen.queryByTestId("qcms-mode-exit")).toBeNull();

    location.pathname = "/operations";
    view.rerender(chrome());
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByTestId("qcms-mode-header").getAttribute("data-mode")).toBe("operations");
    expect(screen.getByTestId("qcms-mode-exit")).toBeTruthy();
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
