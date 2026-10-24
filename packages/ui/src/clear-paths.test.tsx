import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost } from "./test-support/host.tsx";
import { SELECT_STEP } from "./test-support/select-step.ts";

// jsdom rather than the browser (ADR-23): none of this is layout-dependent, and the
// Select is reachable here, which it is not from the portal. What each clear path
// posts, and when, is pinned in the portal's own suite.

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

function renderStep(document: A2UIStepDocument) {
  const changes = vi.fn();
  render(<ControlledHost document={document} onChange={changes} />);
  return changes;
}

function displayed(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

function isChecked(element: HTMLElement): boolean {
  return (element as HTMLInputElement).checked;
}

// Cost scales with the CPU share the runner gets, so the budget is per file rather
// than per test.
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
      // An empty box is the never-answered rendering, so the respondent cannot mean
      // the empty string as a value.
      expect(changes.mock.calls).not.toContainEqual(["q_full_name", ""]);
      // Still empty, so it stayed controlled rather than falling back to react-aria's
      // own last value.
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

      // A NumberField commits its parsed value when editing ends, which is why ADR-31
      // puts the number's commit moment on blur.
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
      // An all-unchecked group is the pristine rendering, so the respondent cannot
      // distinguish it from never having answered.
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

    // Every gesture a respondent might try to un-answer with.
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

    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    await user.keyboard("{Escape}");
    trigger.focus();
    await user.keyboard("{Delete}{Backspace}");

    expect(changes).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("New Zealand");
  });
});

// The native path has no `onChange`, so what has to agree with the scripted cases is
// the bytes it posts. A text question and a multiChoice one fail differently, which is
// why both are here: the text box posts itself empty and the group posts nothing at
// all. Neither this file nor the BFF decoder's own suite carries the claim alone.

describe("the native transport posts the same clear (issue #127)", { timeout: 30_000 }, () => {
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

    expect(serialize()).toContainEqual(["q_full_name", "Ada"]);
    expect(serialize()).toContainEqual(["__qa__q_full_name", "1"]);

    await user.clear(screen.getByRole("textbox", { name: "Full name" }));

    // The marker is still there, because the form was rendered from the answer the
    // server holds. That pair is the clear.
    expect(serialize()).toContainEqual(["q_full_name", ""]);
    expect(serialize()).toContainEqual(["__qa__q_full_name", "1"]);
  });

  it("multiChoice: an emptied group posts NOTHING, and the marker is its only trace", async () => {
    const user = userEvent.setup();
    const serialize = renderNative(stepHistory, { q_preexisting_conditions: ["opt_diabetes"] });

    expect(serialize()).toContainEqual(["q_preexisting_conditions", "opt_diabetes"]);

    await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));

    // A decoder that walked the posted values could not see this clear even in
    // principle, which is why the BFF walks the kind tags.
    const posted = serialize();
    expect(posted.filter(([name]) => name === "q_preexisting_conditions")).toEqual([]);
    expect(posted).toContainEqual(["__qk__q_preexisting_conditions", "multi"]);
    expect(posted).toContainEqual(["__qa__q_preexisting_conditions", "1"]);
  });

  it("date: three emptied boxes post empty WITH the answered marker (issues #920, #127)", async () => {
    const user = userEvent.setup();
    const serialize = renderNative(stepAbout, { q_dob: "1990-05-17" });

    // The native boxes can be emptied, unlike the vendored picker whose value rides a
    // mirror only JavaScript writes, so the decoder turns three blank parts into null.
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
    // The autofill mirror is not rendered on this path.
    expect(serialize().filter(([name]) => name === "q_dob")).toEqual([]);
  });

  it("an unanswered question of either type posts no marker, so its emptiness stays silence", () => {
    const nothing = renderNative(stepHistory, {})();
    expect(nothing.filter(([name]) => name.startsWith("__qa__"))).toEqual([]);
  });
});
