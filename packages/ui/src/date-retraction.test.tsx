import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";

/**
 * The DatePicker adapter must make a CLEARED date observable (issue #95, cause A).
 *
 * react-aria reports a date value only when it becomes complete, and reports
 * `null` only when every segment is empty. A complete date backspaced to a
 * partial one emits nothing at all, so the parent's controlled value stays at
 * the old date: bit-for-bit indistinguishable from "answered and untouched",
 * which is how a cleared required date kept letting Continue through. The
 * adapter therefore reads what the control DISPLAYS at the commit moment and
 * emits `undefined` (the retraction the host posts as a null clear, ADR-31/33).
 *
 * jsdom is the right layer here: nothing in this behaviour is layout- or
 * visibility-dependent (ADR-23). The end-to-end proof that Continue no longer
 * advances lives in the portal's Playwright suite.
 */

const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const stepAbout = kitchen.compiled.documents.find((d) => d.stepId === "stp_about");
if (!stepAbout) throw new Error("stp_about not found");

/** The en-US segmented DateField exposes each segment as a spinbutton. */
function segment(name: RegExp): HTMLElement {
  return screen.getByRole("spinbutton", { name });
}

/** Move focus out of the whole control, which is the date commit moment. */
async function commit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("textbox", { name: "Full name" }));
}

// react-aria interaction in jsdom is CPU-bound (every simulated key dispatches a
// full event sequence and re-renders); the file budget matches keyboard.test.tsx
// rather than adding per-test timeouts (#61).
describe("DatePicker clear is observable at the commit moment", { timeout: 30_000 }, () => {
  it("emits undefined when a complete date is partially cleared, then committed", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    // Answer the date: react-aria emits the complete value once every segment
    // is filled (en-US order MM/DD/YYYY).
    await user.click(segment(/month/i));
    await user.keyboard("05171990");
    expect(changes).toHaveBeenLastCalledWith("q_dob", "1990-05-17");

    // Clear ONE segment. This is the case react-aria never reports: the date is
    // now incomplete but not empty, so no onChange fires.
    changes.mockClear();
    await user.click(segment(/month/i));
    await user.keyboard("{Backspace}");
    expect(segment(/month/i).textContent).toMatch(/mm/i);
    expect(changes).not.toHaveBeenCalled();

    // Committing (focus leaves the control) retracts: the adapter reports the
    // clear the control could not, and does NOT also fire blur behind it - a
    // host that posts on blur would otherwise re-post the stale date.
    await commit(user);
    expect(changes).toHaveBeenCalledWith("q_dob", undefined);
    expect(blurs).not.toHaveBeenCalledWith("q_dob");
  });

  it("commits a complete date as an ordinary blur, with no spurious clear", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    await user.click(segment(/month/i));
    await user.keyboard("05171990");
    changes.mockClear();
    await commit(user);

    // An answered, untouched date is untouched: no retraction, just the blur the
    // host uses for its own touched semantics.
    expect(changes).not.toHaveBeenCalled();
    expect(blurs).toHaveBeenCalledWith("q_dob");
  });

  it("does not manufacture a retraction for a never-answered date", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    // Focus the empty control and leave: there is no stored answer to retract,
    // so the adapter emits nothing beyond the ordinary blur.
    await user.click(segment(/month/i));
    await commit(user);
    expect(changes).not.toHaveBeenCalled();
    expect(blurs).toHaveBeenCalledWith("q_dob");
  });
});
