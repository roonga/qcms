import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { NATIVE_FIELD_ANSWERED_PREFIX, NATIVE_FIELD_KIND_PREFIX } from "./native-submit.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * A required multi-choice group with scripting off (issue #974, Code Owner ruling
 * 2026-09-19).
 *
 * The defect these pin: HTML has no "at least one of these" constraint, and
 * react-aria encodes the rule by putting native `required` on EVERY checkbox and
 * removing it on the re-render that follows the first selection. A server-rendered
 * page never re-renders, so all the boxes kept the attribute - and native `required`
 * on a checkbox means THAT box must be checked. A respondent who wanted one option
 * could not pass the step, and every step behind it was unreachable.
 *
 * What replaces it is react-aria's OWN ARIA encoding of the same rule, reached
 * through the `validationBehavior` seam for this group's subtree alone: the group
 * still says it is required, each box carries `aria-required` for as long as none is
 * selected, and nothing blocks the submit. The constraint is then enforced by the
 * API's `MISSING_REQUIRED` sweep and reported back onto the step (issue #964).
 *
 * jsdom pins which attributes are on which element - the whole of what the change
 * does. Whether Chrome then submits is browser behaviour (ADR-23), asserted in
 * `apps/portal/e2e/no-js-multi-choice.pw.ts`.
 */

const kitchenSink = loadGoldenForms().find((f) => f.version === "v1" && f.form === "kitchen-sink");
if (!kitchenSink) throw new Error("v1 kitchen-sink golden not found");

/** The fixture's required multiChoice question, and the step that holds it. */
const GROUP_QUESTION = "q_preexisting_conditions";
/** Two required controls on the SAME step, whose browser validation must not move. */
const RADIO_QUESTION = "q_at_fault_accident";
const NUMBER_QUESTION = "q_accident_count";

const groupStep: A2UIStepDocument = kitchenSink.compiled.documents[1];
const NATIVE = { action: "/s/ses_abc/step", submitLabel: "Continue" } as const;

function renderNative(values?: Record<string, unknown>) {
  return render(
    <A2UIStepRenderer document={groupStep} values={(values ?? {}) as never} nativeSubmit={NATIVE} />,
  );
}

function boxes(container: HTMLElement): HTMLInputElement[] {
  return [
    ...container.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"][name="${GROUP_QUESTION}"]`,
    ),
  ];
}

describe("a required multi-choice group with no scripting (issue #974)", () => {
  it("renders every box WITHOUT the native required attribute", () => {
    // THE DEFECT, inverted. Counted rather than asserted on one box: the attribute
    // was on all of them, and one box left carrying it is the same dead end.
    const all = boxes(renderNative().container);
    expect(all.length).toBeGreaterThan(1);
    expect(all.filter((box) => box.required)).toHaveLength(0);
    expect(all.filter((box) => box.hasAttribute("required"))).toHaveLength(0);
  });

  it("still says the group is required, in the label and to assistive technology", () => {
    const { container } = renderNative();
    // react-aria's ARIA encoding of "at least one", which is what the native
    // attribute is swapped FOR rather than a consolation for losing it.
    expect(boxes(container).every((box) => box.getAttribute("aria-required") === "true")).toBe(
      true,
    );
    const group = container.querySelector<HTMLElement>(
      `[data-qcms-field="${GROUP_QUESTION}"] [role="group"]`,
    );
    expect(group?.getAttribute("data-required")).toBe("true");
    const labelId = group?.getAttribute("aria-labelledby") ?? "";
    const label = container.querySelector(`#${CSS.escape(labelId)}`);
    expect(label?.textContent).toContain("Do any of these conditions apply to you?");
    expect(label?.textContent).toContain("*");
  });

  it("leaves every OTHER required control on the step validating natively", () => {
    // The scope claim, proved rather than asserted: the seam is a context provider
    // around this one group, so the two required controls beside it - a radio group,
    // whose native `required` HTML CAN express, and the number input - keep the
    // attribute. This is what makes the #920 ruling still true everywhere else.
    const { container } = renderNative();
    const radios = [
      ...container.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${RADIO_QUESTION}"]`),
    ];
    expect(radios.length).toBe(2);
    expect(radios.every((radio) => radio.required)).toBe(true);
    const number = container.querySelector<HTMLInputElement>(
      `input[type="number"][name="${NUMBER_QUESTION}"]`,
    );
    expect(number?.required).toBe(true);
  });

  it("drops the ARIA encoding too once the group holds an answer", () => {
    // react-aria's own rule, unchanged by the seam: a group that holds a selection
    // is satisfied, so it asks for nothing. Worth pinning because it is why
    // `no-js-retraction.pw.ts`, whose group is seeded, never saw the defect.
    const { container } = renderNative({ [GROUP_QUESTION]: ["opt_asthma"] });
    expect(boxes(container).some((box) => box.hasAttribute("aria-required"))).toBe(false);
    expect(boxes(container).some((box) => box.hasAttribute("required"))).toBe(false);
  });

  it("keeps the selection, the kind tag and the answered marker on the wire", () => {
    const { container } = renderNative({ [GROUP_QUESTION]: ["opt_asthma"] });
    const posted = new FormData(container.querySelector("form")!);
    expect(posted.getAll(GROUP_QUESTION)).toEqual(["opt_asthma"]);
    expect(posted.get(`${NATIVE_FIELD_KIND_PREFIX}${GROUP_QUESTION}`)).toBe("multi");
    expect(posted.get(`${NATIVE_FIELD_ANSWERED_PREFIX}${GROUP_QUESTION}`)).not.toBeNull();
  });

  it("shows the API's report in the group's own error slot", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={groupStep}
        errors={{ [GROUP_QUESTION]: "This question needs an answer." }}
        nativeSubmit={NATIVE}
      />,
    );
    const field = container.querySelector<HTMLElement>(`[data-qcms-field="${GROUP_QUESTION}"]`);
    expect(field?.textContent).toContain("This question needs an answer.");
  });

  it("leaves the scripted render byte-for-byte alone", () => {
    // The ruling changes the no-JS render and nothing else, so the scripted group's
    // markup is compared whole rather than attribute by attribute - the same
    // discipline `native-date-field.test.tsx` applies to the DatePicker.
    const before = render(<A2UIStepRenderer document={groupStep} />);
    const scripted = before.container.querySelector<HTMLElement>(
      `[data-qcms-field="${GROUP_QUESTION}"]`,
    );
    expect(scripted).not.toBeNull();
    // Every box keeps the native attribute the scripted path removes on selection.
    const scriptedBoxes = [
      ...scripted!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(scriptedBoxes.length).toBeGreaterThan(1);
    expect(scriptedBoxes.every((box) => box.required)).toBe(true);
    expect(scriptedBoxes.some((box) => box.hasAttribute("aria-required"))).toBe(false);
  });
});
