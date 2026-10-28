import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";
import { SELECT_STEP } from "./test-support/select-step.ts";

// react-stately decides controlled against uncontrolled by `value !== undefined` and warns when that changes.
// The direction that matters is back to uncontrolled, which serves its own last internal value; jsdom sees it
// because the warning is a dev-mode `console.warn`.

const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const documents = kitchen.compiled.documents;

function stepById(id: string): A2UIStepDocument {
  const step = documents.find((d) => d.stepId === id);
  if (!step) throw new Error(`step ${id} not found`);
  return step;
}

const stepAbout = stepById("stp_about");
const stepHistory = stepById("stp_history");
const stepCover = stepById("stp_cover");

// Derived from the golden rather than hand-shaped, so the control sits at exactly the
// same tree index and the reconciliation under test is the real one.
function withRenamedQuestion(step: A2UIStepDocument, from: string, to: string): A2UIStepDocument {
  const rewritten = JSON.stringify(step).replaceAll(from, to);
  return JSON.parse(rewritten) as A2UIStepDocument;
}

let flips: string[] = [];

beforeEach(() => {
  flips = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const text = args.map((a) => String(a)).join(" ");
    if (text.includes("A component changed from")) flips.push(text);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function isChecked(element: HTMLElement): boolean {
  return (element as HTMLInputElement).checked;
}

describe("answering a control does not flip it between controlled and uncontrolled", () => {
  it("boolean RadioGroup: selecting an option stays controlled", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepHistory} />);

    await user.click(screen.getByRole("radio", { name: "Yes" }));

    expect(isChecked(screen.getByRole("radio", { name: "Yes" }))).toBe(true);
    expect(flips).toEqual([]);
  });

  it("singleChoice RadioGroup: selecting an option stays controlled", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepCover} />);

    await user.click(screen.getByRole("radio", { name: "Standard" }));

    expect(isChecked(screen.getByRole("radio", { name: "Standard" }))).toBe(true);
    expect(flips).toEqual([]);
  });

  it("singleChoice Select: choosing an option stays controlled", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={SELECT_STEP} />);

    await user.click(screen.getByRole("button", { name: /Country/ }));
    await user.click(screen.getByRole("option", { name: "New Zealand" }));

    expect(screen.getByRole("button", { name: /Country/ }).textContent).toContain("New Zealand");
    expect(flips).toEqual([]);
  });

  it("the text, number and multi-choice controls stay controlled through entry", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepHistory} />);

    await user.type(screen.getByRole("textbox", { name: /how many/i }), "10");
    await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));
    await user.type(screen.getByRole("textbox", { name: /Relevant medical history/ }), "None");

    expect(flips).toEqual([]);
  });

  it("DatePicker: no longer the exception, and it never displays a stale value", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepAbout} />);

    const month = screen.getByRole("spinbutton", { name: /month/i });
    month.focus();
    await user.keyboard("05171990");

    // The vendored DatePicker passes `value: string | null` through, so the adapter's
    // `NO_SELECTION` reaches react-aria and the date is controlled from the first
    // render.
    expect(flips).toEqual([]);
  });
});

describe("a projection never re-targets a mounted control at another question", () => {
  it("RadioGroup: an answered boolean does not carry its selection into the next question", async () => {
    const user = userEvent.setup();
    // "true"/"false" are also the new question's option values, so a control that kept
    // its state would display the previous question's answer on an unanswered one.
    const nextStep = withRenamedQuestion(
      stepHistory,
      "q_at_fault_accident",
      "q_at_fault_accident_2",
    );
    const { rerender } = render(<ControlledHost document={stepHistory} />);

    await user.click(screen.getByRole("radio", { name: "Yes" }));
    rerender(<ControlledHost document={nextStep} />);

    expect(isChecked(screen.getByRole("radio", { name: "Yes" }))).toBe(false);
    expect(isChecked(screen.getByRole("radio", { name: "No" }))).toBe(false);
    expect(flips).toEqual([]);
  });

  it("RadioGroup: the next question's group is still keyboard-reachable", async () => {
    const user = userEvent.setup();
    // These sit at the same tree index, so Continue re-targeted one mounted group at
    // the other question and carried `lastFocusedValue` across. No option of the new
    // question has that value, so every radio dropped to tabIndex=-1.
    const { rerender } = render(<ControlledHost document={stepHistory} />);

    await user.click(screen.getByRole("radio", { name: "Yes" }));
    rerender(<ControlledHost document={stepCover} />);

    // One tab stop is all reachability requires: with no selection react-aria leaves
    // every radio tabbable and the browser's own grouping does the roving.
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(1);
    expect(radios.some((r) => r.tabIndex === 0)).toBe(true);
    expect(flips).toEqual([]);
  });

  it("DatePicker: an answered date does not carry into the next question", async () => {
    const user = userEvent.setup();
    const nextStep = withRenamedQuestion(stepAbout, "q_dob", "q_dob_2");
    const { rerender } = render(<ControlledHost document={stepAbout} />);

    const month = screen.getByRole("spinbutton", { name: /month/i });
    month.focus();
    await user.keyboard("05171990");
    flips = [];

    rerender(<ControlledHost document={nextStep} />);

    expect(screen.getByRole("spinbutton", { name: /month/i }).textContent).toMatch(/mm/i);
    expect(screen.getByRole("spinbutton", { name: /year/i }).textContent).toMatch(/yyyy/i);
    expect(flips).toEqual([]);
  });

  it("Select: an answered option does not carry into the next question", async () => {
    const user = userEvent.setup();
    const nextStep = withRenamedQuestion(SELECT_STEP, "q_country", "q_country_2");
    const { rerender } = render(<ControlledHost document={SELECT_STEP} />);

    await user.click(screen.getByRole("button", { name: /Country/ }));
    await user.click(screen.getByRole("option", { name: "New Zealand" }));
    rerender(<ControlledHost document={nextStep} />);

    expect(screen.getByRole("button", { name: /Country/ }).textContent).toContain(
      "Select an option",
    );
    expect(flips).toEqual([]);
  });
});
