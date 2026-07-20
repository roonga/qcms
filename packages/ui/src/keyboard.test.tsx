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
const stepHealth = kitchen.compiled.documents.find((d) => d.stepId === "stp_health");
if (!stepHealth) throw new Error("stp_health not found");

describe("kitchen-sink keyboard walkthrough", () => {
  it("Tab visits every control in document order and never the honeypot", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledHost document={stepHealth} />);

    // Roving-tabindex RadioGroup exposes one tab stop (the first radio); the
    // NumberField, each Checkbox, and the TextArea are each their own tab stop.
    const expected = [
      screen.getByRole("radio", { name: "Yes" }),
      screen.getByRole("textbox", { name: /cigarettes/ }),
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
