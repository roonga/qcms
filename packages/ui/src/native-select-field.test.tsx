import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { NATIVE_FIELD_ANSWERED_PREFIX, NATIVE_FIELD_KIND_PREFIX } from "./native-submit.ts";

/**
 * The no-JS single-choice control above the compiler's option threshold (issue #988).
 *
 * The defect these pin: in native-submit mode a `singleChoice` question with more
 * than seven options put a real `<select>` on the page carrying the real options -
 * and put it inside a clipped container that is `aria-hidden="true"` with
 * `tabindex="-1"` on the select, behind a visible `<button aria-haspopup="listbox">`
 * only JavaScript can open. Nothing was missing from the wire; everything was
 * missing from the respondent. A required one was worse than unanswerable: the
 * browser tries to report validity on the unfocusable mirror, cannot, and abandons
 * the whole step's submission.
 *
 * jsdom can pin the MARKUP contract - which element carries the name, whether a
 * respondent can see and reach it, what the browser will validate, and what the form
 * serializes - which is the whole of what the fix changes. Whether Chrome then
 * refuses a blank required select, and what a respondent can operate with scripting
 * genuinely off, is browser behaviour (ADR-23) and is asserted in
 * `apps/portal/e2e/no-js-select.pw.ts`.
 *
 * The document is hand-written rather than loaded from a corpus because no golden
 * form compiles a `Select` at all: every committed single-choice question has four
 * options (`packages/a2ui-compiler/golden/`), which is what kept this whole control
 * unobserved. The props below are exactly what `questionToNode` emits for a
 * singleChoice above `SINGLE_CHOICE_SELECT_THRESHOLD`
 * (`packages/a2ui-compiler/src/mapping.ts`); the e2e vehicle kitchen-sink fixture now
 * carries such a question, which is what lets the browser spec reach one.
 */

const QUESTION = "q_body_type";

/** The nine compiled options, in authored order, as the compiler emits them. */
const ITEMS = [
  { label: "Hatchback", value: "opt_hatchback" },
  { label: "Sedan", value: "opt_sedan" },
  { label: "Wagon", value: "opt_wagon" },
  { label: "SUV", value: "opt_suv" },
  { label: "Ute", value: "opt_ute" },
  { label: "Van", value: "opt_van" },
  { label: "People mover", value: "opt_people_mover" },
  { label: "Coupe", value: "opt_coupe" },
  { label: "Convertible", value: "opt_convertible" },
];

const NATIVE = { action: "/s/ses_abc/step", submitLabel: "Continue" } as const;

/** A step holding one Select question with the given compiled props. */
function selectDocument(props: Readonly<Record<string, unknown>>): A2UIStepDocument {
  return {
    stepId: "stp_select",
    root: { type: "Form", children: [{ type: "Select", props }] },
  };
}

const REQUIRED_DOCUMENT = selectDocument({
  label: "What body type is the vehicle?",
  description: "Pick the closest match",
  name: QUESTION,
  isRequired: true,
  items: ITEMS,
});

function renderNative(
  values?: Record<string, unknown>,
  document: A2UIStepDocument = REQUIRED_DOCUMENT,
) {
  return render(
    <A2UIStepRenderer document={document} values={(values ?? {}) as never} nativeSubmit={NATIVE} />,
  );
}

/** Every `<select>` on the step that would be posted under the question's name. */
function postedSelects(container: HTMLElement): HTMLSelectElement[] {
  return [...container.querySelectorAll<HTMLSelectElement>(`select[name="${QUESTION}"]`)];
}

describe("the no-JS single-choice select (issue #988)", () => {
  it("posts the answer from exactly one select", () => {
    const { container } = renderNative();
    expect(postedSelects(container).length).toBe(1);
  });

  it("puts the select where the respondent can see and reach it", () => {
    // The defect in one assertion. Before the fix the only element carrying the
    // question's name was a `tabindex="-1"` select inside an `aria-hidden`,
    // `position: fixed; clip: rect(0px)` container, so the question was invisible,
    // untabbable and - being unfocusable while invalid - unsubmittable when required.
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    expect(select.closest("[aria-hidden='true']")).toBeNull();
    expect(select.closest("[data-react-aria-prevent-focus]")).toBeNull();
    expect(select.hasAttribute("tabindex")).toBe(false);
    expect(select.hasAttribute("hidden")).toBe(false);
    expect(select.disabled).toBe(false);
    // And the JS-only trigger the respondent used to be left with is gone.
    expect(container.querySelectorAll("[aria-haspopup='listbox']").length).toBe(0);
  });

  it("carries every compiled option, in authored order, under the option ids", () => {
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    // The placeholder, then the nine options: the question is above the compiler's
    // seven-option threshold, which is the only reason it is a Select at all.
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      ...ITEMS.map((item) => item.value),
    ]);
    expect([...select.options].slice(1).map((option) => option.textContent)).toEqual(
      ITEMS.map((item) => item.label),
    );
  });

  it("selects an empty-valued placeholder when the question is unanswered", () => {
    // Both jobs of the empty option depend on this: HTML's own rule makes a
    // `required` select invalid while the selected option's value is "", and it is
    // the only gesture that can return an answered optional select to unanswered.
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    expect(select.value).toBe("");
    expect(select.options[0].value).toBe("");
    expect(select.options[0].disabled).toBe(false);
    expect(select.options[0].textContent).toBe("Select an option");
  });

  it("keeps the browser's own required check, because HTML can express this rule", () => {
    // The #920 ruling keeps browser validation wherever HTML carries the constraint,
    // and "exactly one option chosen" is one it carries - unlike the required
    // checkbox group of #974, where the attribute had to go.
    const { container } = renderNative();
    expect(postedSelects(container)[0].required).toBe(true);
  });

  it("leaves the attribute off an optional question", () => {
    const { container } = renderNative(
      {},
      selectDocument({ label: "Where is it registered?", name: QUESTION, items: ITEMS }),
    );
    expect(postedSelects(container)[0].required).toBe(false);
  });

  it("is labelled by the question's own label, so the browser names it in the report", () => {
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    const label = container.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`);
    expect(label?.textContent).toContain("What body type is the vehicle?");
  });

  it("names the question's description through aria-describedby", () => {
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    const describedBy = select.getAttribute("aria-describedby") ?? "";
    const described = describedBy
      .split(" ")
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent)
      .join(" ");
    expect(described).toContain("Pick the closest match");
  });

  it("seeds the stored answer as an uncontrolled default, so it re-posts unchanged", () => {
    const { container } = renderNative({ [QUESTION]: "opt_wagon" });
    const posted = new FormData(container.querySelector("form")!);
    expect(postedSelects(container)[0].value).toBe("opt_wagon");
    expect(posted.get(QUESTION)).toBe("opt_wagon");
  });

  it("tags the field `string` for the BFF decoder, and marks an answered one", () => {
    const { container } = renderNative({ [QUESTION]: "opt_wagon" });
    const kind = container.querySelector<HTMLInputElement>(
      `input[type="hidden"][name="${NATIVE_FIELD_KIND_PREFIX}${QUESTION}"]`,
    );
    expect(kind?.value).toBe("string");
    expect(
      container.querySelector(
        `input[type="hidden"][name="${NATIVE_FIELD_ANSWERED_PREFIX}${QUESTION}"]`,
      ),
    ).not.toBeNull();
  });

  it("posts an answered field returned to the placeholder empty, so the marker reads as a clear", () => {
    // The gesture that did not exist before: `docs/COMPONENT_GUIDELINES.md` records
    // that a chosen Select option cannot be deselected, which is still true of the
    // scripted control. A native select with an empty-valued placeholder can be
    // returned to it, and the empty value beside the `__qa__` marker is what the BFF
    // decodes as the ADR-33 retraction (issue #127).
    const { container } = renderNative({ [QUESTION]: "opt_wagon" });
    postedSelects(container)[0].value = "";
    const posted = new FormData(container.querySelector("form")!);
    expect(posted.get(QUESTION)).toBe("");
    expect(posted.get(`${NATIVE_FIELD_ANSWERED_PREFIX}${QUESTION}`)).not.toBeNull();
  });

  it("shows the API's refusal in the field's own error slot", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={REQUIRED_DOCUMENT}
        errors={{ [QUESTION]: "Choose a body type" }}
        nativeSubmit={NATIVE}
      />,
    );
    const select = postedSelects(container)[0];
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const describedBy = select.getAttribute("aria-describedby") ?? "";
    const described = describedBy
      .split(" ")
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent)
      .join(" ");
    expect(described).toContain("Choose a body type");
  });

  it("leaves the scripted render alone: the vendored trigger and its clipped mirror", () => {
    const { container } = render(<A2UIStepRenderer document={REQUIRED_DOCUMENT} />);
    // The vendored control, byte-for-byte what it was: a JS-driven trigger button and
    // the hidden select mirror it keeps its form value on.
    expect(container.querySelector("[aria-haspopup='listbox']")).not.toBeNull();
    const mirror = postedSelects(container)[0];
    expect(mirror.getAttribute("tabindex")).toBe("-1");
    expect(mirror.closest("[aria-hidden='true']")).not.toBeNull();
    // And none of the native fallback's markup is on that render.
    expect(container.querySelector(`label[for="${mirror.id}"]`)).toBeNull();
  });
});
