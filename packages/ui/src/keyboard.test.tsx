import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";

/** RAC radio/checkbox render native inputs (`.checked`), falling back to aria-checked. */
function isChecked(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) return element.checked;
  return element.getAttribute("aria-checked") === "true";
}

// Keyboard walkthrough over the kitchen-sink document: Tab order, radio arrow-key
// selection, checkbox Space toggle. Conformance-verified rather than assumed of the
// component library (ADR-22).
const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const stepHealth = kitchen.compiled.documents.find((d) => d.stepId === "stp_history");
if (!stepHealth) throw new Error("stp_history not found");

// These drive real `userEvent` interaction through react-aria in jsdom, which is
// CPU-bound: each simulated key dispatches a full event sequence and react-aria
// re-renders. Cost therefore scales with the CPU share the runner gets, and on a
// starved runner the slowest test crosses Vitest's 5s default while a warm machine
// finishes the file in 1.5s. Which test crosses varies with load, so the budget
// belongs to the file. There is nothing timing-sensitive to restructure: the cost is
// arithmetic rather than an awaited delay. 30s leaves headroom while still failing a
// genuine hang.
describe("kitchen-sink keyboard walkthrough", { timeout: 30_000 }, () => {
  it("Tab visits every control in document order and never the honeypot", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledHost document={stepHealth} />);

    // A roving-tabindex RadioGroup exposes one tab stop; every other control is its
    // own.
    const expected = [
      screen.getByRole("radio", { name: "Yes" }),
      screen.getByRole("textbox", { name: /how many/i }),
      screen.getByRole("checkbox", { name: "Diabetes" }),
      screen.getByRole("checkbox", { name: "Asthma" }),
      screen.getByRole("checkbox", { name: "Heart disease" }),
      screen.getByRole("checkbox", { name: "None of the above" }),
      screen.getByRole("textbox", { name: /Relevant medical history/ }),
    ];

    for (const element of expected) {
      await user.tab();
      expect(document.activeElement).toBe(element);
    }

    // The honeypot input (tabindex=-1, inside aria-hidden) is never reachable.
    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot).not.toBeNull();
    expect(honeypot!.getAttribute("tabindex")).toBe("-1");
    await user.tab();
    expect(document.activeElement).not.toBe(honeypot);
  });

  it("radio arrow keys move and change the selection", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepHealth} />);
    const yes = screen.getByRole("radio", { name: "Yes" });
    const no = screen.getByRole("radio", { name: "No" });

    await user.click(yes);
    expect(isChecked(yes)).toBe(true);

    await user.keyboard("{ArrowDown}");
    expect(isChecked(no)).toBe(true);
    expect(isChecked(yes)).toBe(false);

    await user.keyboard("{ArrowUp}");
    expect(isChecked(yes)).toBe(true);
  });

  it("Space toggles a focused checkbox", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepHealth} />);
    const group = screen.getByRole("group", { name: /Do any of these conditions apply/ });
    const diabetes = within(group).getByRole("checkbox", { name: "Diabetes" });

    diabetes.focus();
    expect(document.activeElement).toBe(diabetes);

    await user.keyboard(" ");
    expect(isChecked(diabetes)).toBe(true);

    await user.keyboard(" ");
    expect(isChecked(diabetes)).toBe(false);
  });
});
