import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { NATIVE_FIELD_ANSWERED_PREFIX, NATIVE_FIELD_KIND_PREFIX } from "./native-submit.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * The no-JS number control (issue #18, Code Owner ruling 2026-09-19).
 *
 * The defect these pin: in native-submit mode a number question put TWO elements on
 * the page and neither could answer it. The visible control was
 * `<input type="text" required inputmode="numeric">` with no `name` at all, and the
 * form value rode a separate `<input type="hidden" name="q_accident_count">` that
 * only react-aria's JavaScript writes. Typing `3` filled the visible box, left the
 * named field `""`, and satisfied the browser's own `required` check, so the step
 * submitted with the answer silently discarded.
 *
 * jsdom can pin the MARKUP contract - which element carries the name, whether the
 * respondent can type into it, and what the browser will validate - which is the
 * whole of what the fix changes. Whether Chrome then refuses `2.5` or `201` is
 * browser behaviour (ADR-23), so it is asserted in
 * `apps/portal/e2e/no-js-required.pw.ts`.
 */

const kitchenSink = loadGoldenForms().find((f) => f.version === "v1" && f.form === "kitchen-sink");
if (!kitchenSink) throw new Error("v1 kitchen-sink golden not found");

/** The fixture's required integer question, and the step that holds it. */
const NUMBER_QUESTION = "q_accident_count";
const numberStep: A2UIStepDocument = kitchenSink.compiled.documents[1];

const NATIVE = { action: "/s/ses_abc/step", submitLabel: "Continue" } as const;

function renderNative(values?: Record<string, unknown>) {
  return render(
    <A2UIStepRenderer
      document={numberStep}
      values={(values ?? {}) as never}
      nativeSubmit={NATIVE}
    />,
  );
}

/** Every control in the form that would be posted under the question's own name. */
function postedFields(container: HTMLElement): HTMLInputElement[] {
  return [
    ...container.querySelectorAll<HTMLInputElement>(`input[name="${NUMBER_QUESTION}"]`),
  ].filter((input) => input.getAttribute("form") !== "");
}

/** A hand-written step holding one number question with the given compiled props. */
function numberDocument(props: Readonly<Record<string, unknown>>): A2UIStepDocument {
  return { stepId: "stp_number", root: { type: "Form", children: [{ type: "NumberField", props }] } };
}

describe("the no-JS number control (issue #18)", () => {
  it("posts the number from exactly one native number input", () => {
    const { container } = renderNative();
    const fields = postedFields(container);
    expect(fields.length).toBe(1);
    expect(fields[0].type).toBe("number");
  });

  it("puts the name on the control the respondent types into", () => {
    // The defect in one assertion. Before the fix the only element carrying the
    // question's name was `type="hidden"`, and the box that took the keystrokes
    // carried no name at all, so what was typed was never on the wire.
    const { container } = renderNative();
    const input = postedFields(container)[0];
    expect(input.type).not.toBe("hidden");
    expect(input.hasAttribute("hidden")).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    expect(input.required).toBe(true);
    // And nothing else on the step answers to that name any more.
    expect(
      container.querySelectorAll(`input[type="hidden"][name="${NUMBER_QUESTION}"]`).length,
    ).toBe(0);
  });

  it("carries the question's numeric bounds as native min/max", () => {
    const { container } = renderNative();
    const input = postedFields(container)[0];
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("200");
  });

  it("carries the compiled integer granularity as step=1 (issues #151, #944)", () => {
    const { container } = renderNative();
    expect(postedFields(container)[0].getAttribute("step")).toBe("1");
  });

  it("says step=any for a question that admits fractions, because HTML's default is 1", () => {
    // The compiler emits `step: 1` for an integer question and NOTHING for a
    // fractional one, and an omitted `step` on a native number input means 1 - so
    // passing the absence through would have the browser refuse the very fractions
    // the question allows. No golden question admits them, hence the hand-written
    // document (the same reason `number-input-mode.test.tsx` writes one).
    const { container } = render(
      <A2UIStepRenderer
        document={numberDocument({
          label: "Litres per 100 km",
          name: "q_consumption",
          minValue: 0,
          maxValue: 30,
        })}
        nativeSubmit={NATIVE}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[name="q_consumption"]');
    expect(input?.getAttribute("step")).toBe("any");
  });

  it("is labelled by the question's own label, so the browser names it in the report", () => {
    const { container } = renderNative();
    const input = postedFields(container)[0];
    const label = container.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
    expect(label?.textContent).toContain("How many?");
  });

  it("names the question's description through aria-describedby", () => {
    const { container } = renderNative();
    const input = postedFields(container)[0];
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const described = describedBy
      .split(" ")
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent)
      .join(" ");
    expect(described).toContain("An average across the last 12 months");
  });

  it("seeds the stored answer as an uncontrolled default, so it re-posts unchanged", () => {
    const { container } = renderNative({ [NUMBER_QUESTION]: 3 });
    expect(postedFields(container)[0].value).toBe("3");
  });

  it("posts the seeded answer as plain digits, never an Intl-formatted string", () => {
    // The scripted control DISPLAYS an `Intl.NumberFormat` rendering; a grouping
    // separator on this path would reach the BFF's `Number(...)` coercion as NaN.
    const { container } = renderNative({ [NUMBER_QUESTION]: 1234 });
    const posted = new FormData(container.querySelector("form")!);
    expect(posted.get(NUMBER_QUESTION)).toBe("1234");
  });

  it("still tags the field `number` for the BFF decoder, and marks an answered one", () => {
    const { container } = renderNative({ [NUMBER_QUESTION]: 3 });
    const kind = container.querySelector<HTMLInputElement>(
      `input[type="hidden"][name="${NATIVE_FIELD_KIND_PREFIX}${NUMBER_QUESTION}"]`,
    );
    expect(kind?.value).toBe("number");
    expect(
      container.querySelector(
        `input[type="hidden"][name="${NATIVE_FIELD_ANSWERED_PREFIX}${NUMBER_QUESTION}"]`,
      ),
    ).not.toBeNull();
  });

  it("posts an emptied answered field empty, so the marker reads as a clear", () => {
    // What the seeded-and-emptied field puts on the wire. Before the fix an answered
    // number could not be emptied at all without scripting - the hidden input kept
    // the seeded value whatever the visible box showed - which is why
    // `native-submit.ts` listed the NumberField as exempt from issue #127.
    const { container } = renderNative({ [NUMBER_QUESTION]: 3 });
    const input = postedFields(container)[0];
    input.value = "";
    const posted = new FormData(container.querySelector("form")!);
    expect(posted.get(NUMBER_QUESTION)).toBe("");
    expect(posted.get(`${NATIVE_FIELD_ANSWERED_PREFIX}${NUMBER_QUESTION}`)).not.toBeNull();
  });

  it("shows the API's refusal in the field's own error slot", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={numberStep}
        errors={{ [NUMBER_QUESTION]: "Answer must be a whole number" }}
        nativeSubmit={NATIVE}
      />,
    );
    const input = postedFields(container)[0];
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const described = describedBy
      .split(" ")
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent)
      .join(" ");
    expect(described).toContain("Answer must be a whole number");
  });

  it("leaves the scripted render alone: no native number input when JS drives the form", () => {
    const { container } = render(<A2UIStepRenderer document={numberStep} />);
    expect(container.querySelector('input[type="number"]')).toBeNull();
    // The vendored control, unchanged: an unnamed text box beside a hidden mirror.
    const visible = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(visible).not.toBeNull();
    expect(visible?.hasAttribute("name")).toBe(false);
    expect(
      container.querySelector(`input[type="hidden"][name="${NUMBER_QUESTION}"]`),
    ).not.toBeNull();
  });
});
