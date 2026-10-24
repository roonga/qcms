import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import type { A2UIValues } from "./field-context.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { SELECT_STEP } from "./test-support/select-step.ts";

/**
 * Every control type displays the value it is given at mount.
 *
 * A resumed session mounted its value map empty, so a respondent came back to
 * previously answered questions rendered blank while the server still held the
 * answers. This pins the adapters' half: a value present in `values` on the first
 * render reaches the control.
 *
 * The first render is the whole point, and the clear-path and round-trip suites do
 * not imply it: those start from `{}` and watch a value the respondent just typed
 * flow back. react-stately decides controlled against uncontrolled from the first
 * value it sees, and several adapters translate the canonical `AnswerValue` into a
 * different control-level shape, so a value arriving before any interaction is its
 * own path.
 *
 * jsdom is the right layer (ADR-23): none of this is layout-dependent, and the Select
 * is reachable here, which it is not from the portal.
 */

const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const compiled = kitchen.compiled;

function stepById(id: string): A2UIStepDocument {
  const step = compiled.documents.find((d) => d.stepId === id);
  if (!step) throw new Error(`step ${id} not found`);
  return step;
}

/** Render one golden step with the values a resumed session would arrive holding. */
function renderSeeded(document: A2UIStepDocument, values: A2UIValues): void {
  render(
    <A2UIStepRenderer document={document} values={values} specVersion={compiled.a2uiSpecVersion} />,
  );
}

/** What a text-like control (TextField, TextArea, NumberField) displays. */
function displayed(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

/** Whether a radio or checkbox is selected. */
function isChecked(element: HTMLElement): boolean {
  return (element as HTMLInputElement).checked;
}

/** One segment of the en-US segmented DateField. */
function segment(name: RegExp): HTMLElement {
  return screen.getByRole("spinbutton", { name });
}

describe("a value present on the first render is displayed by its control", () => {
  it("shortText: the stored text fills the field", () => {
    renderSeeded(stepById("stp_about"), { q_full_name: "Ada Lovelace" });
    expect(displayed(screen.getByRole("textbox", { name: "Full name" }))).toBe("Ada Lovelace");
  });

  it("date: the stored ISO date fills every segment", () => {
    renderSeeded(stepById("stp_about"), { q_dob: "1990-05-17" });
    // The canonical encoding is a timezone-less ISO day, drawn in the en-US segment
    // order, so no segment is left on its placeholder.
    expect(segment(/month/i).textContent).toMatch(/^0?5$/);
    expect(segment(/day/i).textContent).toBe("17");
    expect(segment(/year/i).textContent).toBe("1990");
  });

  it("boolean: the stored JSON boolean selects the matching radio", () => {
    renderSeeded(stepById("stp_history"), { q_at_fault_accident: true });
    // The adapter translates the canonical boolean to the radio's string value, since
    // a raw `true` would match no radio.
    expect(isChecked(screen.getByRole("radio", { name: "Yes" }))).toBe(true);
    expect(isChecked(screen.getByRole("radio", { name: "No" }))).toBe(false);
  });

  it("boolean: false selects the No radio, never leaving the group blank", () => {
    renderSeeded(stepById("stp_history"), { q_at_fault_accident: false });
    expect(isChecked(screen.getByRole("radio", { name: "No" }))).toBe(true);
    expect(isChecked(screen.getByRole("radio", { name: "Yes" }))).toBe(false);
  });

  it("number: the stored number fills the field", () => {
    renderSeeded(stepById("stp_history"), { q_accident_count: 3 });
    expect(displayed(screen.getByRole("textbox", { name: /how many/i }))).toBe("3");
  });

  it("longText: the stored text fills the textarea", () => {
    renderSeeded(stepById("stp_history"), { q_medical_history: "Mild asthma since 2019." });
    expect(displayed(screen.getByRole("textbox", { name: /Relevant medical history/ }))).toBe(
      "Mild asthma since 2019.",
    );
  });

  it("multiChoice: every stored OptionId is checked and nothing else is", () => {
    renderSeeded(stepById("stp_history"), {
      q_preexisting_conditions: ["opt_asthma", "opt_heart_disease"],
    });
    expect(isChecked(screen.getByRole("checkbox", { name: "Asthma" }))).toBe(true);
    expect(isChecked(screen.getByRole("checkbox", { name: "Heart disease" }))).toBe(true);
    expect(isChecked(screen.getByRole("checkbox", { name: "Diabetes" }))).toBe(false);
    expect(isChecked(screen.getByRole("checkbox", { name: "None of the above" }))).toBe(false);
  });

  it("singleChoice as a RadioGroup: the stored OptionId selects its radio", () => {
    renderSeeded(stepById("stp_cover"), { q_coverage_level: "opt_premium" });
    expect(isChecked(screen.getByRole("radio", { name: "Premium" }))).toBe(true);
    expect(isChecked(screen.getByRole("radio", { name: "Basic" }))).toBe(false);
  });

  it("singleChoice as a Select: the stored OptionId shows its option label", () => {
    render(<A2UIStepRenderer document={SELECT_STEP} values={{ q_country: "opt_de" }} />);
    // The collapsed Select shows the option's label rather than its OptionId, because
    // the value is looked up as an option key, which is why the adapter never passes
    // "" for no selection.
    expect(screen.getByRole("button", { name: /Country/ }).textContent).toContain("Germany");
  });

  it("an unanswered question stays empty: no control invents a value", () => {
    renderSeeded(stepById("stp_history"), {});
    expect(displayed(screen.getByRole("textbox", { name: /how many/i }))).toBe("");
    expect(displayed(screen.getByRole("textbox", { name: /Relevant medical history/ }))).toBe("");
    expect(isChecked(screen.getByRole("radio", { name: "Yes" }))).toBe(false);
    expect(isChecked(screen.getByRole("radio", { name: "No" }))).toBe(false);
    expect(isChecked(screen.getByRole("checkbox", { name: "Asthma" }))).toBe(false);
  });
});
