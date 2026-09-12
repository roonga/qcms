import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";
import { SELECT_STEP } from "./test-support/select-step.ts";

/**
 * Every control type's CLEAR path, at the adapter seam (issue #98, ADR-33).
 *
 * The audit this suite pins: one respondent gesture ("I emptied this field") must
 * report one thing, and that thing is **absence** (`undefined`), which the host
 * posts as the single ADR-33 retraction at that control's ADR-31 commit moment.
 * Before this, the text controls reported an empty STRING and the checkbox group an
 * empty ARRAY - both legal `AnswerValue`s, so both satisfied `required` while
 * holding nothing, and both were rejected 422 by any constraint that forbids the
 * empty value, which left the server holding the stale answer (issue #95's defect
 * class). Two controls have no clear gesture at all, which is asserted here rather
 * than assumed: a chosen radio and a chosen Select option cannot be deselected.
 *
 * jsdom is the right layer for what each ADAPTER emits (ADR-23): none of it is
 * layout- or visibility-dependent, and the Select is reachable here at all, which
 * it is not from the portal (no fixture form has a singleChoice above the
 * compiler's Select threshold). What each clear path POSTS, and when, is pinned end
 * to end in the portal's `clear-paths.pw.ts`; the DatePicker's own clear path,
 * which needed a DOM read to be observable at all, is `date-retraction.test.tsx`.
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

/** Render one step document with a change spy, which is the suite's whole subject. */
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

// react-aria interaction in jsdom is CPU-bound (every simulated key dispatches a
// full event sequence and re-renders); the file budget matches keyboard.test.tsx
// and date-retraction.test.tsx rather than adding per-test timeouts (#61).
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
      // The empty string is never emitted at all: it is not a value the respondent
      // can mean, because an empty box IS the never-answered rendering.
      expect(changes.mock.calls).not.toContainEqual(["q_full_name", ""]);
      // ...and the control still shows empty, so it stayed controlled through the
      // clear rather than falling back to react-aria's own last value.
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
      // The renderer draws whatever the document contains: the adapter is the
      // subject here, not the rule that gates this question in a live flow.
      const count = screen.getByRole("textbox", { name: /how many/i });

      // A NumberField commits its parsed value when editing ends, so the answer and
      // the clear are both read after focus leaves (the round-trip suite does the
      // same); ADR-31 puts the number's commit moment on blur for the same reason.
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
      // The empty SET is never emitted. It is not "an answer of nothing": an
      // all-unchecked group is the pristine rendering, so the respondent cannot
      // distinguish it from never having answered. An author who wants "none of
      // these" to be sayable gives the question that option - a real OptionId.
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

    // Every gesture a respondent might try to "un-answer" with. None of them is a
    // clear: react-aria emits no change and the radio stays checked. So a boolean
    // or singleChoice question travels unanswered -> answered -> another answer and
    // never back to unanswered (whole-session erasure is the only other door).
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

    // There is no clear affordance to press (the vendored Select renders a value
    // and a chevron, no clear button) ...
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    // ... and no gesture empties the selection: closing the popover with Escape, or
    // pressing Delete / Backspace on the trigger, leaves the chosen option chosen
    // and emits nothing.
    await user.keyboard("{Escape}");
    trigger.focus();
    await user.keyboard("{Delete}{Backspace}");

    expect(changes).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("New Zealand");
  });
});

/**
 * The same gesture on the NATIVE (no-JS) transport (issue #127).
 *
 * The cases above pin what the scripted path reports: `undefined`, which the portal
 * posts to the answer endpoint as `value ?? null`, so a clear reaches the API as a
 * literal `null` (`components/step-flow.tsx`). The native path has no `onChange` to
 * report anything - the browser posts the form - so what has to agree is the BYTES
 * it posts. This is the half that makes the two transports one behaviour rather than
 * two, and it is asserted for a text question and for a multiChoice question because
 * they fail differently: the text box posts itself EMPTY, the checkbox group posts
 * NOTHING AT ALL, and before the marker both were indistinguishable from a question
 * nobody had answered.
 *
 * The pairs asserted here - the `__qa__` marker present, the field carrying nothing -
 * are the exact inputs `decodeStepForm` turns into `{ questionId, value: null }`, in
 * `apps/portal/lib/server/step-form.test.ts`. Together the two files say that one
 * respondent gesture reaches one ledger call down either transport; neither says it
 * alone, so neither may be deleted without the other's claim being re-made.
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

    // Cleared: the field is present and empty, and the marker is STILL there - the
    // form was rendered from the answer the server holds, and emptying a box cannot
    // un-render it. That pair is the clear.
    expect(serialize()).toContainEqual(["q_full_name", ""]);
    expect(serialize()).toContainEqual(["__qa__q_full_name", "1"]);
  });

  it("multiChoice: an emptied group posts NOTHING, and the marker is its only trace", async () => {
    const user = userEvent.setup();
    const serialize = renderNative(stepHistory, { q_preexisting_conditions: ["opt_diabetes"] });

    expect(serialize()).toContainEqual(["q_preexisting_conditions", "opt_diabetes"]);

    await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));

    // No entry for the question at all. A decoder that walked the posted values
    // could not see this clear even in principle, which is why the BFF walks the
    // kind tags instead.
    const posted = serialize();
    expect(posted.filter(([name]) => name === "q_preexisting_conditions")).toEqual([]);
    expect(posted).toContainEqual(["__qk__q_preexisting_conditions", "multi"]);
    expect(posted).toContainEqual(["__qa__q_preexisting_conditions", "1"]);
  });

  it("an unanswered question of either type posts no marker, so its emptiness stays silence", async () => {
    const nothing = renderNative(stepHistory, {})();
    expect(nothing.filter(([name]) => name.startsWith("__qa__"))).toEqual([]);
  });
});
