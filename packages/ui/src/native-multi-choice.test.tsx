import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { NATIVE_FIELD_ANSWERED_PREFIX, NATIVE_FIELD_KIND_PREFIX } from "./native-submit.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

// HTML has no "at least one of these" constraint, so react-aria puts native `required`
// on every checkbox and removes it on the re-render after the first selection. A
// server-rendered page never re-renders, so a partial selection could not pass the
// step. jsdom pins which attributes are on which element; whether the browser then
// submits is browser behaviour (ADR-23), asserted in the portal's own suite.

const kitchenSink = loadGoldenForms().find((f) => f.version === "v1" && f.form === "kitchen-sink");
if (!kitchenSink) throw new Error("v1 kitchen-sink golden not found");

const GROUP_QUESTION = "q_preexisting_conditions";
/** Their browser validation must not move. */
const RADIO_QUESTION = "q_at_fault_accident";
const NUMBER_QUESTION = "q_accident_count";

const groupStep: A2UIStepDocument = kitchenSink.compiled.documents[1];
const NATIVE = { action: "/s/ses_abc/step", submitLabel: "Continue" } as const;

function renderNative(values?: Record<string, unknown>) {
  return render(
    <A2UIStepRenderer
      document={groupStep}
      values={(values ?? {}) as never}
      nativeSubmit={NATIVE}
    />,
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
    // Counted rather than asserted on one box: one box left carrying it is the same
    // dead end.
    const all = boxes(renderNative().container);
    expect(all.length).toBeGreaterThan(1);
    expect(all.filter((box) => box.required)).toHaveLength(0);
    expect(all.filter((box) => box.hasAttribute("required"))).toHaveLength(0);
  });

  it("still says the group is required, in the label and to assistive technology", () => {
    const { container } = renderNative();
    // What the native attribute is swapped for, rather than a consolation.
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
    // The seam is a context provider around this one group, so the controls beside it
    // keep the native attribute, which is what keeps browser validation true elsewhere.
    const { container } = renderNative();
    const radios = [
      ...container.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${RADIO_QUESTION}"]`,
      ),
    ];
    expect(radios.length).toBe(2);
    expect(radios.every((radio) => radio.required)).toBe(true);
    const number = container.querySelector<HTMLInputElement>(
      `input[type="number"][name="${NUMBER_QUESTION}"]`,
    );
    expect(number?.required).toBe(true);
  });

  it("drops the ARIA encoding too once the group holds an answer", () => {
    // Unchanged by the seam, and why a suite whose group is seeded never saw the
    // defect.
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

  it("leaves the scripted render's required encoding alone", () => {
    // A whole-markup comparison would need the base's own output to diff against,
    // which a single-head suite does not have.
    const before = render(<A2UIStepRenderer document={groupStep} />);
    const scripted = before.container.querySelector<HTMLElement>(
      `[data-qcms-field="${GROUP_QUESTION}"]`,
    );
    expect(scripted).not.toBeNull();
    const scriptedBoxes = [
      ...scripted!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(scriptedBoxes.length).toBeGreaterThan(1);
    expect(scriptedBoxes.every((box) => box.required)).toBe(true);
    expect(scriptedBoxes.some((box) => box.hasAttribute("aria-required"))).toBe(false);
  });
});
