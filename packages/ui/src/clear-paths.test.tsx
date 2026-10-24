import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";
import { SELECT_STEP } from "./test-support/select-step.ts";

/**
 * Every control type's clear path, at the adapter seam (ADR-33).
 *
 * One respondent gesture reports one thing, and that thing is absence, which the host
 * posts as a single ADR-33 retraction at the control's ADR-31 commit moment. Two
 * controls have no clear gesture at all, which is asserted here rather than assumed.
 *
 * jsdom is the right layer for what each adapter emits (ADR-23): none of it is layout-
 * or visibility-dependent, and the Select is reachable here, which it is not from the
 * portal. What each clear path posts, and when, is pinned in the portal's own suite.
 */

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

/** Render one step document with a change spy, the suite's whole subject. */
function renderStep(document: A2UIStepDocument) {
  const changes = vi.fn();
  render(<ControlledHost document={document} onChange={changes} />);
  return changes;
}

/** What a text-like control currently displays. */
function displayed(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

/** Whether a radio or checkbox is currently selected. */
function isChecked(element: HTMLElement): boolean {
  return (element as HTMLInputElement).checked;
}

// react-aria interaction in jsdom is CPU-bound, since every simulated key dispatches
// a full event sequence and re-renders, so the budget is per file rather than per test.
describe(
  "an emptied control reports absence, not an answer of nothing",
  { timeout: 30_000 },
  () => {
    it("shortText: clearing the text emits undefined, never an empty string", async () => {
      const user = userEvent.setup();
      const changes = renderStep(stepAbout);
      const name = screen.getByRole("textbox", { name: "Full name" });

      await user.type(name, "Ada");
      expect(changes).toHaveBeenLastCalledWith("q_full_name", "Ada");

      await user.clear(name);
      expect(changes).toHaveBeenLastCalledWith("q_full_name", undefined);
      // The empty string is never emitted: it is not a value the respondent can mean,
      // because an empty box is the never-answered rendering.
      expect(changes.mock.calls).not.toContainEqual(["q_full_name", ""]);
      // Still empty, so it stayed controlled through the clear rather than falling
      // back to react-aria's own last value.
      expect(displayed(name)).toBe("");
    });

    it("longText: clearing the text emits undefined, never an empty string", async () => {
      const user = userEvent.setup();
      const changes = renderStep(stepHistory);
      const detail = screen.getByRole("textbox", { name: /Relevant medical history/ });

      await user.type(detail, "No claims");
      expect(changes).toHaveBeenLastCalledWith("q_medical_history", "No claims");

      await user.clear(detail);
      expect(changes).toHaveBeenLastCalledWith("q_medical_history", undefined);
      expect(changes.mock.calls).not.toContainEqual(["q_medical_history", ""]);
      expect(displayed(detail)).toBe("");
    });

    it("number: clearing the field emits undefined", async () => {
      const user = userEvent.setup();
      const changes = renderStep(stepHistory);
      const count = screen.getByRole("textbox", { name: /how many/i });

      // A NumberField commits its parsed value when editing ends, which is also why
      // ADR-31 puts the number's commit moment on blur.
      await user.type(count, "10");
      await user.tab();
      expect(changes).toHaveBeenLastCalledWith("q_accident_count", 10);

      await user.clear(count);
      await user.tab();
      expect(changes).toHaveBeenLastCalledWith("q_accident_count", undefined);
      expect(displayed(count)).toBe("");
    });

    it("multiChoice: unchecking the last option emits undefined, never an empty array", async () => {
      const user = userEvent.setup();
      const changes = renderStep(stepHistory);
      const diabetes = screen.getByRole("checkbox", { name: "Diabetes" });

      await user.click(diabetes);
      expect(changes).toHaveBeenLastCalledWith("q_preexisting_conditions", ["opt_diabetes"]);

      await user.click(diabetes);
      expect(changes).toHaveBeenLastCalledWith("q_preexisting_conditions", undefined);
      // The empty set is never emitted: an all-unchecked group is the pristine
      // rendering, so the respondent cannot distinguish it from never having answered.
      // An author who wants "none of these" gives the question that option.
      expect(changes.mock.calls).not.toContainEqual(["q_preexisting_conditions", []]);
      expect(isChecked(diabetes)).toBe(false);
    });

    it("multiChoice: unchecking ONE of several is still an answer, not a clear", async () => {
      const user = userEvent.setup();
      const changes = renderStep(stepHistory);

      await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));
      await user.click(screen.getByRole("checkbox", { name: "Asthma" }));
      expect(changes).toHaveBeenLastCalledWith("q_preexisting_conditions", [
        "opt_diabetes",
        "opt_asthma",
      ]);

      await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));
      expect(changes).toHaveBeenLastCalledWith("q_preexisting_conditions", ["opt_asthma"]);
    });
  },
);

describe("the discrete controls have no clear gesture", { timeout: 30_000 }, () => {
  it("boolean RadioGroup: a chosen radio cannot be deselected", async () => {
    const user = userEvent.setup();
    const changes = renderStep(stepHistory);
    const yes = screen.getByRole("radio", { name: "Yes" });

    await user.click(yes);
    expect(changes).toHaveBeenCalledWith("q_at_fault_accident", true);
    changes.mockClear();

    // Every gesture a respondent might try to un-answer with. None is a clear, so such
    // a question travels unanswered to answered to another answer and never back.
    await user.click(yes);
    yes.focus();
    await user.keyboard("{Delete}{Backspace}{Escape} ");

    expect(changes).not.toHaveBeenCalled();
    expect(isChecked(yes)).toBe(true);
  });

  it("singleChoice Select: a chosen option cannot be deselected", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    render(<ControlledHost document={SELECT_STEP} onChange={changes} />);
    const trigger = screen.getByRole("button", { name: /Country/ });

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "New Zealand" }));
    expect(changes).toHaveBeenCalledWith("q_country", "opt_nz");
    changes.mockClear();

    // No clear affordance to press, and no gesture empties the selection either.
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    await user.keyboard("{Escape}");
    trigger.focus();
    await user.keyboard("{Delete}{Backspace}");

    expect(changes).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("New Zealand");
  });
});

/**
 * The same gesture on the native (no-JS) transport.
 *
 * The native path has no `onChange` to report anything, so what has to agree with the
 * scripted cases above is the bytes it posts. A text question and a multiChoice one
 * fail differently, which is why both are asserted: the text box posts itself empty
 * and the checkbox group posts nothing at all, and before the marker both were
 * indistinguishable from a question nobody had answered.
 *
 * The pairs asserted here are the exact inputs the BFF decoder turns into a null
 * answer, which its own suite pins. Together the two files say that one gesture
 * reaches one ledger call down either transport, and neither says it alone.
 */
describe("the native transport posts the same clear (issue #127)", { timeout: 30_000 }, () => {
  /** Render a step natively-submittable with `values` already answered, and serialize it. */
  function renderNative(document: A2UIStepDocument, values: Record<string, unknown>) {
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        values={values as never}
        nativeSubmit={{ action: "/s/ses_127/step", submitLabel: "Continue" }}
      />,
    );
    return () => [...new FormData(container.querySelector("form")!).entries()];
  }

  it("shortText: an emptied box posts empty WITH its answered marker", async () => {
    const user = userEvent.setup();
    const serialize = renderNative(stepAbout, { q_full_name: "Ada" });

    // Answered: the value is on the wire and the marker says so.
    expect(serialize()).toContainEqual(["q_full_name", "Ada"]);
    expect(serialize()).toContainEqual(["__qa__q_full_name", "1"]);

    await user.clear(screen.getByRole("textbox", { name: "Full name" }));

    // Cleared: the field is present and empty and the marker is still there, because
    // the form was rendered from the answer the server holds. That pair is the clear.
    expect(serialize()).toContainEqual(["q_full_name", ""]);
    expect(serialize()).toContainEqual(["__qa__q_full_name", "1"]);
  });

  it("multiChoice: an emptied group posts NOTHING, and the marker is its only trace", async () => {
    const user = userEvent.setup();
    const serialize = renderNative(stepHistory, { q_preexisting_conditions: ["opt_diabetes"] });

    expect(serialize()).toContainEqual(["q_preexisting_conditions", "opt_diabetes"]);

    await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));

    // No entry for the question at all: a decoder that walked the posted values could
    // not see this clear even in principle, which is why the BFF walks the kind tags.
    const posted = serialize();
    expect(posted.filter(([name]) => name === "q_preexisting_conditions")).toEqual([]);
    expect(posted).toContainEqual(["__qk__q_preexisting_conditions", "multi"]);
    expect(posted).toContainEqual(["__qa__q_preexisting_conditions", "1"]);
  });

  it("date: three emptied boxes post empty WITH the answered marker (issues #920, #127)", async () => {
    const user = userEvent.setup();
    const serialize = renderNative(stepAbout, { q_dob: "1990-05-17" });

    // The native boxes can be emptied, unlike the vendored segmented picker whose form
    // value rides a mirror only JavaScript writes, so the clear pair forms for a date
    // exactly as it does for a text box and the decoder turns three blank parts into
    // the same null.
    expect(serialize()).toContainEqual(["__qdd__q_dob", "17"]);
    expect(serialize()).toContainEqual(["__qdm__q_dob", "05"]);
    expect(serialize()).toContainEqual(["__qdy__q_dob", "1990"]);
    expect(serialize()).toContainEqual(["__qk__q_dob", "date"]);
    expect(serialize()).toContainEqual(["__qa__q_dob", "1"]);

    for (const part of ["Day", "Month", "Year"]) {
      await user.clear(screen.getByLabelText(part));
    }

    for (const prefix of ["__qdd__", "__qdm__", "__qdy__"]) {
      expect(serialize()).toContainEqual([`${prefix}q_dob`, ""]);
    }
    expect(serialize()).toContainEqual(["__qa__q_dob", "1"]);
    // Nothing posts under the bare question name: the mirror is not rendered here.
    expect(serialize().filter(([name]) => name === "q_dob")).toEqual([]);
  });

  it("an unanswered question of either type posts no marker, so its emptiness stays silence", () => {
    const nothing = renderNative(stepHistory, {})();
    expect(nothing.filter(([name]) => name.startsWith("__qa__"))).toEqual([]);
  });
});
