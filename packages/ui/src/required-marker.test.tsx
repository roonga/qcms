import { render } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenSteps } from "./test-support/golden.ts";

/**
 * A required question is perceivable as required BEFORE its error fires (issue #99).
 *
 * The marker is rendered by each vendored control inside its own `<Label>`, not by
 * the adapter, so this is a property of the vendored set rather than of
 * `registry.tsx`: a control that shipped without the marker was silently missing it
 * for every required question of that type. The DatePicker was exactly that case,
 * fixed upstream in a2-react-aria and arriving here through the `a2ra.json` pin.
 *
 * The set of required controls is DERIVED from the golden corpus rather than written
 * down (CONTRIBUTING: a property of "every X" derives its X), so a corpus generation
 * that introduces a required question of a new type is covered the day it lands
 * instead of quietly falling outside a hard-coded list.
 */

interface RequiredControl {
  readonly type: string;
  readonly label: string;
  readonly name: string;
}

/** Every `isRequired` node of one compiled step, with the label it renders. */
function requiredControlsIn(node: unknown, found: RequiredControl[] = []): RequiredControl[] {
  if (Array.isArray(node)) {
    for (const child of node) requiredControlsIn(child, found);
    return found;
  }
  if (typeof node !== "object" || node === null) return found;
  const record = node as Record<string, unknown>;
  const props = record["props"];
  if (typeof props === "object" && props !== null) {
    const p = props as Record<string, unknown>;
    if (
      p["isRequired"] === true &&
      typeof record["type"] === "string" &&
      typeof p["label"] === "string" &&
      typeof p["name"] === "string"
    ) {
      found.push({ type: record["type"], label: p["label"], name: p["name"] });
    }
  }
  for (const value of Object.values(record)) requiredControlsIn(value, found);
  return found;
}

interface Case {
  readonly label: string;
  readonly step: A2UIStepDocument;
  readonly specVersion: string;
  readonly control: RequiredControl;
}

const cases: Case[] = loadGoldenSteps().flatMap((step) =>
  requiredControlsIn(step.document).map((control) => ({
    label: `${step.version}/${step.form}/${step.stepId} ${control.type} ${control.name}`,
    step: step.document,
    specVersion: step.specVersion,
    control,
  })),
);

/**
 * The one control whose marker is NOT hidden from assistive technology, pinned here
 * rather than left as an unstated difference.
 *
 * Six of the seven vendored controls wrap the marker in `aria-hidden="true"`, so a
 * screen reader announces the field's required STATE (`aria-required`) and not a
 * literal asterisk. The vendored `NumberField` does not, so its computed accessible
 * name ends in " *" - visible in the conformance snapshot as `"How many? *"`. That
 * inconsistency was found while diagnosing #99 and is upstream work in
 * a2-react-aria, out of scope for the pin move that carried #99, #148 and #549.
 *
 * This is an exact-set assertion, so it fails the day upstream fixes it: that
 * failure is the prompt to delete this exception, not a regression.
 */
const MARKER_IN_ACCESSIBLE_NAME = new Set(["NumberField"]);

/**
 * The controls that convey required only VISUALLY, pinned for the same reason.
 *
 * react-aria-components puts `aria-required` on the element carrying the control's
 * semantics for the single-value controls, but a `CheckboxGroup` gets only
 * `data-required="true"` - a styling hook, invisible to assistive technology - so a
 * required multiChoice question announces nothing about being required until its
 * error fires. That is the same defect family as #99 one control over, it sits in
 * react-aria-components rather than in the vendored wrapper, and it is outside the
 * pin move that carried #99, #148 and #549. Recorded here so it is a known gap with
 * a failing-when-fixed marker rather than an unstated one.
 */
const REQUIRED_STATE_NOT_EXPOSED = new Set(["CheckboxGroup"]);

/** The `display:contents` wrapper the adapter puts around one question's control. */
function fieldWrapper(container: HTMLElement, name: string): HTMLElement {
  const wrapper = container.querySelector<HTMLElement>(`[data-qcms-field="${name}"]`);
  if (!wrapper) throw new Error(`no rendered field for ${name}`);
  return wrapper;
}

/** The marker spans inside one control: a bare `*`, whatever wraps it. */
function markersIn(wrapper: HTMLElement): HTMLElement[] {
  return Array.from(wrapper.querySelectorAll<HTMLElement>("span")).filter(
    (span) => span.textContent?.trim() === "*",
  );
}

describe("every required control renders the required marker (issue #99)", () => {
  it("derives its cases from the corpus, and the corpus has some", () => {
    expect(cases.length).toBeGreaterThan(0);
    // The derivation reaches more than one control type, or it proves nothing about
    // consistency ACROSS controls, which is the property #99 is about.
    expect(new Set(cases.map((c) => c.control.type)).size).toBeGreaterThan(1);
  });

  it("covers the DatePicker, the control this issue was filed against", () => {
    expect(cases.some((c) => c.control.type === "DatePicker")).toBe(true);
  });

  it.each(cases.map((c) => [c.label, c] as const))(
    "%s renders one marker inside its label",
    (_label, { step, specVersion, control }) => {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} />,
      );
      const markers = markersIn(fieldWrapper(container, control.name));
      expect(markers).toHaveLength(1);
      // Inside the label, beside the label text, exactly as the six controls that
      // already had it: an adapter-level marker rendered outside the label span
      // would satisfy "a marker exists" while reading differently to a screen
      // reader walking the label, which is why #99 rejected the adapter seam.
      expect(markers[0]?.parentElement?.textContent).toBe(`${control.label} *`);
    },
  );

  it.each(cases.map((c) => [c.label, c] as const))(
    "%s conveys required in the accessibility tree",
    (_label, { step, specVersion, control }) => {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} />,
      );
      const wrapper = fieldWrapper(container, control.name);

      // The required STATE, which is what assistive technology reports. RAC sets it
      // from `isRequired` on whatever element carries the control's semantics: the
      // input for the text-shaped controls, each date segment for the DatePicker,
      // the group for the checkbox and radio groups.
      const required = wrapper.querySelectorAll("[aria-required='true'], [required]");
      expect(required.length > 0).toBe(!REQUIRED_STATE_NOT_EXPOSED.has(control.type));

      // And the NAME still reads as the question, with the asterisk hidden - except
      // for the one control documented above.
      const labelled = wrapper.querySelector<HTMLElement>("[aria-labelledby], [id]");
      expect(labelled).not.toBeNull();
      const named = Array.from(wrapper.querySelectorAll<HTMLElement>("*"))
        .map((el) => computeAccessibleName(el))
        .filter((name) => name.startsWith(control.label));
      expect(named.length).toBeGreaterThan(0);
      const leaks = named.some((name) => name.includes("*"));
      expect(leaks).toBe(MARKER_IN_ACCESSIBLE_NAME.has(control.type));
    },
  );

  it("pins exactly which controls leak the marker into their accessible name", () => {
    const leaking = new Set<string>();
    for (const { step, specVersion, control } of cases) {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} />,
      );
      const wrapper = fieldWrapper(container, control.name);
      const marker = markersIn(wrapper)[0];
      if (marker?.getAttribute("aria-hidden") !== "true") leaking.add(control.type);
    }
    expect(leaking).toEqual(MARKER_IN_ACCESSIBLE_NAME);
  });
});
