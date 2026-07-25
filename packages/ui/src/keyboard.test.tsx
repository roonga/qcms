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

// Keyboard walkthrough (exit criterion 4) over the kitchen-sink document:
// forward Tab order across every control, radio arrow-key selection, checkbox
// Space toggle - the interactions component libraries "usually" supply but this
// task conformance-verifies rather than assumes (a2ui-mapping.md / ADR-22).
const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const stepHealth = kitchen.compiled.documents.find((d) => d.stepId === "stp_history");
if (!stepHealth) throw new Error("stp_history not found");

// Every test here drives real `userEvent` interaction through react-aria in
// jsdom, which is CPU-bound work: each simulated key dispatches a full event
// sequence and react-aria re-renders the RadioGroup/CheckboxGroup on every one.
// Cost therefore scales with the CPU share the runner gets. On a starved runner
// (one core shared with ~26 busy processes) the slowest test in this file crosses
// Vitest's 5000ms default while the rest land in the 2-5s range, on a file a warm
// machine finishes in 1.5s - which is how issue #61's flake appeared under CI
// load. Which test crosses varies with load, and in practice it is "Tab visits
// every control" rather than the "radio arrow keys" case the issue happened to
// catch, so the budget belongs to the file and not to one test. There is nothing
// timing-sensitive to restructure either: the cost is arithmetic, not an awaited
// delay (`userEvent.setup({ delay: null })` was measured and changed nothing).
// 30s leaves clear headroom over the worst starved observation while still
// failing a genuine hang, the same trade the Testcontainers e2e project makes
// with its 120s (see the root vitest.config.ts).
describe("kitchen-sink keyboard walkthrough", { timeout: 30_000 }, () => {
  it("Tab visits every control in document order and never the honeypot", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledHost document={stepHealth} />);

    // Roving-tabindex RadioGroup exposes one tab stop (the first radio); the
    // NumberField, each Checkbox, and the TextArea are each their own tab stop.
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
