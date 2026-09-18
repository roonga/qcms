import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { NATIVE_FIELD_KIND_PREFIX } from "./native-submit.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * The no-JS date control (issue #920).
 *
 * The defect these pin: in native-submit mode the DatePicker's form value was an
 * `<input type="text" hidden required>`, which `willValidate` is true for and which
 * the browser cannot focus to report the failure, so Chrome abandoned the whole
 * step's submit with `An invalid form control with name='q_dob' is not focusable`.
 * A required date question was a no-JS dead end, and the segmented control it sat
 * behind could not be typed into without scripting either.
 *
 * jsdom can pin the MARKUP contract - which element carries the name, whether it is
 * focusable, what the browser will validate - which is the whole of what the fix
 * changes. Whether Chrome then submits the form is layout- and browser-behaviour
 * dependent (ADR-23), so it is asserted in `apps/portal/e2e/no-js-required.pw.ts`.
 */

const kitchenSink = loadGoldenForms().find((f) => f.version === "v1" && f.form === "kitchen-sink");
if (!kitchenSink) throw new Error("v1 kitchen-sink golden not found");

/** The fixture's required date question, and the step that holds it. */
const DATE_QUESTION = "q_dob";
const dateStep = kitchenSink.compiled.documents[0] as A2UIStepDocument;

const NATIVE = { action: "/s/ses_abc/step", submitLabel: "Continue" } as const;

function renderNative(values?: Record<string, string>) {
  return render(
    <A2UIStepRenderer document={dateStep} values={values ?? {}} nativeSubmit={NATIVE} />,
  );
}

/** Every control in the form that would be posted under the question's own name. */
function postedFields(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>(`input[name="${DATE_QUESTION}"]`)].filter(
    // An empty `form` attribute owns the control to no form at all, so react-aria's
    // autofill mirror never serializes; only what the form owns is on the wire.
    (input) => input.getAttribute("form") !== "",
  );
}

describe("the no-JS date control (issue #920)", () => {
  it("posts the date from exactly one native day input", () => {
    const { container } = renderNative();
    const fields = postedFields(container);
    expect(fields.length).toBe(1);
    expect(fields[0]!.type).toBe("date");
  });

  it("renders a control the browser can validate AND focus", () => {
    const { container } = renderNative();
    const input = postedFields(container)[0]!;
    // The defect in one assertion: the element carrying the constraint is not
    // hidden, so a browser reporting its validity has somewhere to put the message.
    expect(input.required).toBe(true);
    expect(input.hasAttribute("hidden")).toBe(false);
    expect(input.type).not.toBe("hidden");
    expect(input.disabled).toBe(false);
  });

  it("carries the question's ISO day bounds as native min/max", () => {
    const { container } = renderNative();
    const input = postedFields(container)[0]!;
    expect(input.getAttribute("min")).toBe("1900-01-01");
    expect(input.getAttribute("max")).toBe("2100-12-31");
  });

  it("is labelled by the question's own label, so the browser names it in the report", () => {
    const { container } = renderNative();
    const input = postedFields(container)[0]!;
    const label = container.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
    expect(label?.textContent).toContain("Date of birth");
  });

  it("seeds the stored answer as an uncontrolled default, so it re-posts unchanged", () => {
    const { container } = renderNative({ [DATE_QUESTION]: "1990-05-17" });
    expect(postedFields(container)[0]!.value).toBe("1990-05-17");
  });

  it("still tags the field `string` for the BFF decoder", () => {
    const { container } = renderNative();
    const kind = container.querySelector<HTMLInputElement>(
      `input[type="hidden"][name="${NATIVE_FIELD_KIND_PREFIX}${DATE_QUESTION}"]`,
    );
    expect(kind?.value).toBe("string");
  });

  it("shows the API's refusal in the field's own error slot", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={dateStep}
        errors={{ [DATE_QUESTION]: "That date is out of range." }}
        nativeSubmit={NATIVE}
      />,
    );
    const input = postedFields(container)[0]!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const described = describedBy
      .split(" ")
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent)
      .join(" ");
    expect(described).toContain("That date is out of range.");
  });

  it("leaves the scripted render alone: no native day input when JS drives the form", () => {
    const { container } = render(<A2UIStepRenderer document={dateStep} />);
    expect(container.querySelector('input[type="date"]:not([form=""])')).toBeNull();
    expect(container.querySelectorAll('[role="spinbutton"]').length).toBeGreaterThan(0);
  });
});
