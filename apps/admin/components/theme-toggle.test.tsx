import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle.tsx";
import { APPEARANCE_CLASSES, MODE_COOKIE } from "../lib/appearance.ts";

/**
 * The appearance panel's open and close bookkeeping.
 *
 * The panel closes itself when focus leaves it, which it has to measure on the next tick
 * because a press inside reports focus passing through nothing. That deferred check is
 * what is pinned here: the palette and the keyboard model belong to
 * `apps/admin/e2e/appearance.pw.ts`, which needs a real compositor and real focus.
 */

function toggle() {
  return render(
    <ThemeToggle appearance={{ polarity: "light", contrast: "normal" }} secureCookies={false} />,
  );
}

const trigger = () => screen.getByRole("button", { name: /^Appearance: / });
const panel = () => screen.queryByRole("dialog", { name: "Appearance" });

afterEach(() => {
  vi.useRealTimers();
  for (const candidate of APPEARANCE_CLASSES) document.documentElement.classList.remove(candidate);
  document.cookie = `${MODE_COOKIE}=; Path=/; Max-Age=0`;
});

describe("the appearance panel's close-on-blur check", () => {
  it("closes the panel when focus leaves it for the page", () => {
    vi.useFakeTimers();
    toggle();
    fireEvent.click(trigger());
    expect(panel()).not.toBeNull();

    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => {
      outside.focus();
      vi.runOnlyPendingTimers();
    });

    expect(panel()).toBeNull();
    outside.remove();
  });

  it("survives a reopen that beats the previous close's deferred check", () => {
    // Closing moves focus back to the trigger, so the check sees focus outside the panel
    // and would close it - except that by the time it runs the operator may have pressed
    // the trigger again. It reopened and then shut on its own, which is the appearance
    // keyboard spec's first-attempt failure on a loaded host.
    vi.useFakeTimers();
    toggle();
    fireEvent.click(trigger());
    const opened = panel();
    expect(opened).not.toBeNull();

    fireEvent.keyDown(opened as HTMLElement, { key: "Escape" });
    expect(panel()).toBeNull();

    fireEvent.click(trigger());
    expect(panel()).not.toBeNull();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(panel(), "the reopened panel must outlive the old panel's blur check").not.toBeNull();
  });
});
