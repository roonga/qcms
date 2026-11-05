import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailToggle, SidebarProvider } from "./sidebar-toggle.tsx";
import { t } from "../lib/i18n/en.ts";
import {
  isRailShortcut,
  RAIL_REGION_ID,
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_COOKIE,
  SIDEBAR_HOLD_ATTRIBUTE,
  parseSidebarSetting,
  sidebarHidden,
} from "../lib/sidebar.ts";

function shell(setting: "shown" | "hidden" = "shown") {
  return render(
    <SidebarProvider setting={setting} secureCookies={false}>
      <RailToggle />
      <aside id={RAIL_REGION_ID}>
        <a href="/questions">All questions</a>
        <input aria-label="Search" />
      </aside>
      <input aria-label="Page field" />
    </SidebarProvider>,
  );
}

const toggle = () => screen.getByTestId("qcms-rail-toggle");

const SHORTCUT = { altKey: true, shiftKey: true, code: "KeyS", key: "S" };

function viewport(wide: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: wide,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

beforeEach(() => {
  viewport(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute(SIDEBAR_ATTRIBUTE);
  document.documentElement.removeAttribute(SIDEBAR_HOLD_ATTRIBUTE);
  document.cookie = `${SIDEBAR_COOKIE}=; Path=/; Max-Age=0`;
});

describe("the rail toggle", () => {
  it("collapses on press, remembers it and keeps focus on itself", async () => {
    const user = userEvent.setup();
    shell();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-controls")).toBe(RAIL_REGION_ID);
    expect(toggle().getAttribute("aria-label")).toBe(t("rail.collapse"));

    await user.click(toggle());

    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("hidden");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=hidden`);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe(t("rail.expand"));
    expect(document.activeElement).toBe(toggle());
  });

  it("expands again from a remembered collapse", async () => {
    const user = userEvent.setup();
    shell("hidden");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle());
    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("shown");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=shown`);
  });

  it("answers Alt+Shift+S, and moves focus out of a rail it collapses", () => {
    shell();
    screen.getByRole("link", { name: "All questions" }).focus();
    fireEvent.keyDown(document, SHORTCUT);
    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("hidden");
    expect(document.activeElement).toBe(toggle());

    fireEvent.keyDown(document, SHORTCUT);
    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("shown");
  });

  it("leaves Alt+Shift+S to a text field outside the rail", () => {
    shell();
    screen.getByRole("textbox", { name: "Page field" }).focus();
    fireEvent.keyDown(document, SHORTCUT);
    expect(document.documentElement.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);

    screen.getByRole("textbox", { name: "Search" }).focus();
    fireEvent.keyDown(document, SHORTCUT);
    expect(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)).toBe("hidden");
  });

  it("ignores the chord below the breakpoint, where the toggle is not shown", () => {
    viewport(false);
    shell();
    fireEvent.keyDown(document, SHORTCUT);
    expect(document.documentElement.hasAttribute(SIDEBAR_ATTRIBUTE)).toBe(false);
    expect(document.cookie).not.toContain(`${SIDEBAR_COOKIE}=hidden`);
  });

  it("reads the chord from the physical key", () => {
    expect(isRailShortcut({ ...SHORTCUT, ctrlKey: false, metaKey: false })).toBe(true);
    expect(isRailShortcut({ ...SHORTCUT, key: "Í", ctrlKey: false, metaKey: false })).toBe(true);
    expect(isRailShortcut({ ...SHORTCUT, ctrlKey: true, metaKey: false })).toBe(false);
    expect(isRailShortcut({ ...SHORTCUT, shiftKey: false, ctrlKey: false, metaKey: false })).toBe(
      false,
    );
    expect(
      isRailShortcut({ ...SHORTCUT, code: "KeyA", key: "A", ctrlKey: false, metaKey: false }),
    ).toBe(false);
  });

  it("keeps the operator's setting out of a temporary hold", () => {
    expect(sidebarHidden("shown", true)).toBe(true);
    expect(sidebarHidden("shown", false)).toBe(false);
    expect(sidebarHidden("hidden", false)).toBe(true);
    expect(parseSidebarSetting(undefined)).toBe("shown");
    expect(parseSidebarSetting("nonsense")).toBe("shown");
    expect(parseSidebarSetting("hidden")).toBe("hidden");
  });
});
