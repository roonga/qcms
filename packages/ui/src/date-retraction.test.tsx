import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";

// react-aria reports a date only when it becomes complete, and `null` only when every
// segment is empty, so a complete date backspaced to a partial one emits nothing and
// the parent's value stays at the old date, indistinguishable from untouched.

const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const stepAbout = kitchen.compiled.documents.find((d) => d.stepId === "stp_about");
if (!stepAbout) throw new Error("stp_about not found");

function segment(name: RegExp): HTMLElement {
  return screen.getByRole("spinbutton", { name });
}

async function commit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("textbox", { name: "Full name" }));
}

// Cost scales with the CPU share the runner gets, so the budget is per file.
describe("DatePicker clear is observable at the commit moment", { timeout: 30_000 }, () => {
  it("emits undefined when a complete date is partially cleared, then committed", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    // en-US order is MM/DD/YYYY.
    await user.click(segment(/month/i));
    await user.keyboard("05171990");
    expect(changes).toHaveBeenLastCalledWith("q_dob", "1990-05-17");

    // The case react-aria never reports: incomplete but not empty.
    changes.mockClear();
    await user.click(segment(/month/i));
    await user.keyboard("{Backspace}");
    expect(segment(/month/i).textContent).toMatch(/mm/i);
    expect(changes).not.toHaveBeenCalled();

    // Blur is deliberately not also fired, or a host that posts on blur would re-post
    // the stale date.
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

    expect(changes).not.toHaveBeenCalled();
    expect(blurs).toHaveBeenCalledWith("q_dob");
  });

  it("does not manufacture a retraction for a never-answered date", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    const blurs = vi.fn();
    render(<ControlledHost document={stepAbout} onChange={changes} onBlur={blurs} />);

    await user.click(segment(/month/i));
    await commit(user);
    expect(changes).not.toHaveBeenCalled();
    expect(blurs).toHaveBeenCalledWith("q_dob");
  });
});
