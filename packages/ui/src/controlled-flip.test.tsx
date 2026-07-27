import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";
import { SELECT_STEP } from "./test-support/select-step.ts";

/**
 * A control never changes between controlled and uncontrolled, and never serves a
 * second question (issue #144).
 *
 * react-stately's `useControlledState` decides controlled-vs-uncontrolled by
 * `value !== undefined` alone and warns, once per mounted control, when that
 * decision changes: `WARN: A component changed from uncontrolled to controlled.`
 * A full browser run emitted 57 of those (51 one way, 6 the other), and the
 * direction that matters is the reverse one: an uncontrolled react-stately control
 * serves its OWN last internal value in place of the parent's absence, which is the
 * issue-#95 divergence class this seam already exists to prevent.
 *
 * Two causes, both fixed at the seam and both pinned here:
 *
 * 1. The discrete controls passed `undefined` for "no selection", so the first
 *    selection flipped the control from uncontrolled to controlled. They now pass
 *    react-aria's own no-selection value, `null`, which is controlled and (unlike
 *    `""`) keeps the roving tabindex and the option-key contract.
 * 2. `A2Renderer` keys children by array index, so a step swap or a branch prune
 *    re-targeted a MOUNTED control at a different question, flipping it back to
 *    uncontrolled and carrying its internal state across. Each control is now keyed
 *    by questionId, so a re-target is a remount.
 *
 * jsdom is the layer that can see this (ADR-23): the warning is a dev-mode
 * `console.warn` from react-stately, and both consequences (a stale selection
 * displayed, a radio group whose every radio is `tabIndex=-1`) are readable
 * properties of the rendered control rather than anything layout-dependent. The
 * respondent-visible half of case 2 is also pinned end to end in the portal's
 * `a11y-keyboard.pw.ts`.
 */

const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");

function stepById(id: string): A2UIStepDocument {
  const step = kitchen.compiled.documents.find((d) => d.stepId === id);
  if (!step) throw new Error(`step ${id} not found`);
  return step;
}

const stepAbout = stepById("stp_about");
const stepHistory = stepById("stp_history");
const stepCover = stepById("stp_cover");

/**
 * The same step document with one question renamed: a second step whose control of
 * that type sits at exactly the same tree index, which is what makes React
 * reconcile the two questions onto one mounted control. Derived from the golden
 * rather than hand-shaped, so the reconciliation being tested is the real one.
 */
function withRenamedQuestion(step: A2UIStepDocument, from: string, to: string): A2UIStepDocument {
  const rewritten = JSON.stringify(step).replaceAll(from, to);
  return JSON.parse(rewritten) as A2UIStepDocument;
}

/** react-stately's controlled/uncontrolled warnings, in order. */
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

/** Whether a radio or checkbox is currently selected. */
function isChecked(element: HTMLElement): boolean {
  return (element as HTMLInputElement).checked;
}

// react-aria interaction in jsdom is CPU-bound (every simulated key dispatches a
// full event sequence and re-renders); the file budget matches clear-paths.test.tsx
// rather than adding per-test timeouts (#61).
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

  it("DatePicker: the one documented exception, and it never displays a stale value", async () => {
    const user = userEvent.setup();
    render(<ControlledHost document={stepAbout} />);

    const month = screen.getByRole("spinbutton", { name: /month/i });
    month.focus();
    await user.keyboard("05171990");

    // The vendored DatePicker collapses every empty spelling to `undefined`
    // (`value ? parseDate(value) : undefined`), so an unanswered date IS
    // uncontrolled and the first complete value flips it once. That single
    // transition is benign: the value react-stately adopts is the one it just
    // reported. The harm the flip could do (react-aria redisplaying its own value
    // in place of the parent's) is prevented by the adapter's remount key, asserted
    // in the re-target suite below and in `date-retraction.test.tsx`. Removing this
    // last transition needs `value: string | null` in the vendored component
    // (upstream, then a re-vendor), which ADR-22 keeps out of this repo.
    expect(flips).toEqual(["WARN: A component changed from uncontrolled to controlled."]);
  });
});

describe("a projection never re-targets a mounted control at another question", () => {
  it("RadioGroup: an answered boolean does not carry its selection into the next question", async () => {
    const user = userEvent.setup();
    // The same step with the boolean question renamed: its RadioGroup sits at the
    // same index, and "true"/"false" are also the new question's option values, so
    // a control that kept its internal state would DISPLAY the previous question's
    // answer on a question nobody has answered.
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
    // The kitchen-sink navigation that exposed this: step 2's boolean RadioGroup and
    // step 3's singleChoice RadioGroup sit at the same tree index, so Continue
    // re-targeted one mounted group at the other question. It carried react-aria's
    // `lastFocusedValue` ("true") across, and since no option of the new question
    // has that value, EVERY radio dropped to tabIndex=-1: a required question no
    // keyboard or screen-reader respondent could reach.
    const { rerender } = render(<ControlledHost document={stepHistory} />);

    await user.click(screen.getByRole("radio", { name: "Yes" }));
    rerender(<ControlledHost document={stepCover} />);

    // At least one radio is a tab stop, which is all "reachable" requires: with no
    // selection react-aria leaves every radio tabbable and the browser's own radio
    // grouping does the roving. The defect state was every radio at tabIndex=-1.
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

    // Every segment shows its placeholder again: the new question's date field is
    // empty, not the previous question's answer redisplayed by react-aria.
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
