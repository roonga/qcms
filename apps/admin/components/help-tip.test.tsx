import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FieldHelp, HelpTip } from "./help-tip.tsx";

const trigger = () => screen.getByRole("button", { name: "More information" });
const tip = () => screen.getByRole("tooltip", { hidden: true });
const isOpen = () => tip().getAttribute("data-open") === "true";

/** Hover waits 150ms before opening, so a pass over the glyph does not flash a tip. */
function hover(element: HTMLElement): void {
  fireEvent.pointerEnter(element);
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

/** Leaving grants 200ms to cross into the tip before it closes. */
function leave(element: HTMLElement): void {
  fireEvent.pointerLeave(element);
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

function atViewport({
  viewport,
  left,
  width,
  height = 40,
}: {
  readonly viewport: number;
  readonly left: number;
  readonly width: number;
  readonly height?: number;
}): void {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(viewport);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left,
    top: 16,
    bottom: 40,
    width: 24,
  } as DOMRect);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the help tip", () => {
  it("opens on hover and closes when the pointer leaves", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    expect(isOpen()).toBe(false);

    hover(trigger());
    expect(isOpen()).toBe(true);

    leave(trigger());
    expect(isOpen()).toBe(false);
  });

  it("stays open while the pointer is over the tip itself (WCAG 1.4.13)", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    hover(trigger());
    fireEvent.pointerLeave(trigger());
    fireEvent.pointerEnter(tip());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(isOpen()).toBe(true);
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
    hover(trigger());
    leave(trigger());

    expect(isOpen()).toBe(true);
  });

  it("holds one tip open at a time", () => {
    render(
      <>
        <HelpTip label="First">One.</HelpTip>
        <HelpTip label="Second">Two.</HelpTip>
      </>,
    );
    const [first, second] = screen.getAllByRole("button");
    if (first === undefined || second === undefined) throw new Error("two tips are expected");

    hover(first);
    hover(second);

    const tips = screen.getAllByRole("tooltip", { hidden: true });
    expect(tips.map((node) => node.getAttribute("data-open"))).toEqual(["false", "true"]);
  });

  it("names the button after the label it belongs to", () => {
    render(
      <HelpTip label="Retention in days">Responses older than this are erased each night.</HelpTip>,
    );

    expect(screen.getByRole("button", { name: "Help: Retention in days" })).not.toBeNull();
  });

  it("draws the glyph rather than typing it, so no row can stretch it", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);

    expect(trigger().querySelector("svg")).not.toBeNull();
    expect(trigger().textContent).toBe("");
  });

  it("places an open tip against the viewport, so a hidden one cannot widen the page", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    expect(tip().style.position).toBe("");
    expect(tip().style.left).toBe("");

    atViewport({ viewport: 1200, left: 100, width: 288 });
    hover(trigger());

    expect(tip().style.left).toBe("92px");
    expect(tip().style.top).toBe("48px");
    expect(tip().getAttribute("data-placement")).toBe("bottom");
  });

  it("flips above the glyph when the tip would cross the bottom edge", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 760,
      bottom: 784,
      width: 24,
    } as DOMRect);

    hover(trigger());

    expect(tip().getAttribute("data-placement")).toBe("top");
    expect(tip().style.top).toBe("692px");
  });

  it("pulls a tip back inside the viewport rather than letting it run off the end", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    atViewport({ viewport: 390, left: 300, width: 288 });

    hover(trigger());

    expect(tip().style.left).toBe("86px");
  });

  it("keeps a tip off the start edge when it is wider than the viewport allows", () => {
    render(<HelpTip>Only published versions can be pinned.</HelpTip>);
    atViewport({ viewport: 390, left: 4, width: 600 });

    hover(trigger());

    expect(tip().style.left).toBe("16px");
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
