import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";

/**
 * The DatePicker adapter must make a cleared date observable.
 *
 * react-aria reports a date value only when it becomes complete and `null` only when
 * every segment is empty, so a complete date backspaced to a partial one emits
 * nothing and the parent's value stays at the old date, indistinguishable from
 * answered and untouched. The adapter therefore reads what the control displays at
 * the commit moment and emits the ADR-33 retraction.
 *
 * jsdom is the right layer: none of this is layout- or visibility-dependent (ADR-23).
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

// react-aria interaction in jsdom is CPU-bound, since every simulated key dispatches
// a full event sequence and re-renders, so the budget is per file rather than per test.
describe("DatePicker clear is observable at the commit moment", { timeout: 30_000 }, () => {
  it("emits undefined when a complete date is partially cleared, then committed", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    // react-aria emits the complete value once every segment is filled, in en-US
    // order MM/DD/YYYY.
    await user.click(segment(/month/i));
    await user.keyboard("05171990");
    expect(changes).toHaveBeenLastCalledWith("q_dob", "1990-05-17");

    // The case react-aria never reports: incomplete but not empty, so no onChange.
    changes.mockClear();
    await user.click(segment(/month/i));
    await user.keyboard("{Backspace}");
    expect(segment(/month/i).textContent).toMatch(/mm/i);
    expect(changes).not.toHaveBeenCalled();

    // Focus leaving the control commits the retraction, and blur is deliberately not
    // also fired, or a host that posts on blur would re-post the stale date.
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

    // An untouched date retracts nothing, just the blur for touched semantics.
    expect(changes).not.toHaveBeenCalled();
    expect(blurs).toHaveBeenCalledWith("q_dob");
  });

  it("does not manufacture a retraction for a never-answered date", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    // No stored answer to retract, so nothing beyond the ordinary blur.
    await user.click(segment(/month/i));
    await commit(user);
    expect(changes).not.toHaveBeenCalled();
    expect(blurs).toHaveBeenCalledWith("q_dob");
  });
});
