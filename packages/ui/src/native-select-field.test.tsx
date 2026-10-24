import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { NATIVE_FIELD_ANSWERED_PREFIX, NATIVE_FIELD_KIND_PREFIX } from "./native-submit.ts";

/**
 * The no-JS single-choice control above the compiler's option threshold.
 *
 * In native-submit mode such a question used to put a real `<select>` on the page
 * carrying the real options, inside a clipped `aria-hidden` container with
 * `tabindex="-1"`, behind a trigger only JavaScript can open. Nothing was missing from
 * the wire and everything was missing from the respondent, and a required one was
 * worse than unanswerable: the browser tries to report validity on the unfocusable
 * mirror, cannot, and abandons the whole step's submission.
 *
 * jsdom pins the markup contract: which element carries the name, whether a respondent
 * can see and reach it, what the browser will validate, and what the form serializes.
 * The browser half is asserted in the portal's own suite (ADR-23).
 *
 * The document is hand-written because no golden form compiles a `Select` at all,
 * which is what kept this control unobserved. The props are what the compiler emits
 * for a single choice above its threshold.
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
    // The defect in one assertion: the only element carrying the question's name used
    // to be a `tabindex="-1"` select inside an `aria-hidden`, clipped container.
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    expect(select.closest("[aria-hidden='true']")).toBeNull();
    expect(select.closest("[data-react-aria-prevent-focus]")).toBeNull();
    expect(select.hasAttribute("tabindex")).toBe(false);
    expect(select.hasAttribute("hidden")).toBe(false);
    expect(select.disabled).toBe(false);
    // And the JS-only trigger is gone.
    expect(container.querySelectorAll("[aria-haspopup='listbox']").length).toBe(0);
  });

  it("carries every compiled option, in authored order, under the option ids", () => {
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    // The placeholder, then the options.
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      ...ITEMS.map((item) => item.value),
    ]);
    expect([...select.options].slice(1).map((option) => option.textContent)).toEqual(
      ITEMS.map((item) => item.label),
    );
  });

  it("selects an empty-valued placeholder when the question is unanswered", () => {
    // Both jobs of the empty option depend on this: HTML holds a `required` select
    // invalid while the selected option's value is empty, and it is the only gesture
    // that returns an answered optional select to unanswered.
    const { container } = renderNative();
    const select = postedSelects(container)[0];
    expect(select.value).toBe("");
    expect(select.options[0].value).toBe("");
    expect(select.options[0].disabled).toBe(false);
    expect(select.options[0].textContent).toBe("Select an option");
  });

  it("keeps the browser's own required check, because HTML can express this rule", () => {
    // Browser validation stays wherever HTML carries the constraint, and "exactly one
    // option chosen" is one it carries, unlike a required checkbox group.
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
    // A chosen Select option cannot be deselected on the scripted path
    // (docs/COMPONENT_GUIDELINES.md), but a native select can be returned to its
    // empty-valued placeholder, and that value beside the marker is what the BFF
    // decodes as the ADR-33 retraction.
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
    // The vendored control, unchanged: a JS-driven trigger and its hidden mirror.
    expect(container.querySelector("[aria-haspopup='listbox']")).not.toBeNull();
    const mirror = postedSelects(container)[0];
    expect(mirror.getAttribute("tabindex")).toBe("-1");
    expect(mirror.closest("[aria-hidden='true']")).not.toBeNull();
    // And none of the native fallback's markup is on that render.
    expect(container.querySelector(`label[for="${mirror.id}"]`)).toBeNull();
  });
});
