import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FieldHelp, HelpTip } from "./help-tip.tsx";

const trigger = () => screen.getByRole("button", { name: "More information" });
const tip = () => screen.getByRole("tooltip", { hidden: true });
const isOpen = () => tip().getAttribute("data-open") === "true";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the help tip", () => {
  it("opens on hover and closes when the pointer leaves", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    expect(isOpen()).toBe(false);

    fireEvent.pointerEnter(trigger());
    expect(isOpen()).toBe(true);

    fireEvent.pointerLeave(trigger());
    expect(isOpen()).toBe(false);
  });

  it("opens on keyboard focus and closes when focus leaves", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    fireEvent.focus(trigger());
    expect(isOpen()).toBe(true);

    fireEvent.blur(trigger());
    expect(isOpen()).toBe(false);
  });

  it("dismisses on Escape while focus stays on the button", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    fireEvent.focus(trigger());
    expect(isOpen()).toBe(true);

    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(isOpen()).toBe(false);
  });

  it("toggles on a tap, which fires no hover", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    fireEvent.click(trigger());
    expect(isOpen()).toBe(true);

    fireEvent.click(trigger());
    expect(isOpen()).toBe(false);
  });

  it("keeps an open tip while the pointer leaves a button that still holds focus", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    trigger().focus();
    fireEvent.focus(trigger());
    fireEvent.pointerEnter(trigger());
    fireEvent.pointerLeave(trigger());

    expect(isOpen()).toBe(true);
  });

  it("flips to the inline end when the tip would run past the viewport", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 380,
    } as DOMRect);

    fireEvent.pointerEnter(trigger());

    expect(tip().className).toContain("qcms-helptip__body--end");
  });

  it("leaves the tip at the inline start when it fits", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 100,
    } as DOMRect);

    fireEvent.pointerEnter(trigger());

    expect(tip().className).not.toContain("qcms-helptip__body--end");
  });

  it("describes the button rather than naming it, so the tip is not the accessible name", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    expect(trigger().getAttribute("aria-describedby")).toBe(tip().id);
  });

  it("puts a field's help beside the field, outside its label", () => {
    render(
      <FieldHelp help="Only published versions can be pinned.">
        <label htmlFor="slug">Slug</label>
        <input id="slug" />
      </FieldHelp>,
    );

    expect(screen.getByLabelText("Slug")).not.toBeNull();
    expect(trigger().closest("label")).toBeNull();
  });
});
