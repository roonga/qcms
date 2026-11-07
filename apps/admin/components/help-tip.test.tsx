import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FieldHelp, HelpTip } from "./help-tip.tsx";

const trigger = () => screen.getByRole("button", { name: "More information" });
const tip = () => screen.getByRole("tooltip", { hidden: true });
const isOpen = () => tip().getAttribute("data-open") === "true";

function atViewport({
  viewport,
  left,
  width,
}: {
  readonly viewport: number;
  readonly left: number;
  readonly width: number;
}): void {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(viewport);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left,
    bottom: 40,
  } as DOMRect);
}

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

  it("places an open tip against the viewport, so a hidden one cannot widen the page", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    expect(tip().style.position).toBe("");
    expect(tip().style.left).toBe("");

    atViewport({ viewport: 1200, left: 100, width: 288 });
    fireEvent.pointerEnter(trigger());

    expect(tip().style.left).toBe("100px");
    expect(tip().style.top).toBe("46px");
  });

  it("pulls a tip back inside the viewport rather than letting it run off the end", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    atViewport({ viewport: 390, left: 300, width: 288 });

    fireEvent.pointerEnter(trigger());

    expect(tip().style.left).toBe("94px");
  });

  it("keeps a tip off the start edge when it is wider than the viewport allows", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    atViewport({ viewport: 390, left: 4, width: 600 });

    fireEvent.pointerEnter(trigger());

    expect(tip().style.left).toBe("8px");
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
