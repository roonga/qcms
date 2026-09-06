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
 * The controls whose marker is NOT hidden from assistive technology: none of them,
 * since the pin moved past roonga/a2-react-aria#78 (issue #789).
 *
 * Six of the seven vendored controls already wrapped the marker in
 * `aria-hidden="true"`, so a screen reader announces the field's required STATE
 * (`aria-required`) and not a literal asterisk. The vendored `NumberField` did not,
 * so its computed accessible name ended in " *" - visible in the conformance
 * snapshot as `"How many? *"`. It was found while diagnosing #99, reported rather
 * than patched here because ADR-22 freezes the vendored tree byte-for-byte, and
 * fixed upstream in the pass this exception was written to survive.
 *
 * The set stays, empty, rather than being deleted along with the assertions reading
 * it: it is what makes "no control leaks its marker" an exhaustive claim over the
 * corpus-derived set instead of a sentence, and a control that regresses names
 * itself in a diff.
 */
const MARKER_IN_ACCESSIBLE_NAME = new Set<string>();

/**
 * The controls that convey required only VISUALLY: none of them, for the same
 * reason.
 *
 * react-aria-components puts `aria-required` on the element carrying the control's
 * semantics for the single-value controls, and a `CheckboxGroup` got only
 * `data-required="true"` - a styling hook, invisible to assistive technology - so a
 * required multiChoice announced nothing about being required until its error fired.
 * The cause was in the vendored `Checkbox`, which defaulted `isRequired` to `false`
 * and passed it down: react-aria resolves a group item's required state as
 * `props.isRequired ?? state.isRequired`, so the literal `false` won over the group
 * and the group's own required state reached none of its items.
 *
 * ARIA does not allow `aria-required` on `role="group"`, so the upstream fix does not
 * put it there. Each checkbox carries it instead (or `required`, under native
 * validation) for exactly as long as nothing in the group is selected, which is
 * react-aria's own encoding of "at least one" - which is why the assertion below
 * searches the whole field wrapper rather than the group element.
 */
const REQUIRED_STATE_NOT_EXPOSED = new Set<string>();

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
      const { container } = render(<A2UIStepRenderer document={step} specVersion={specVersion} />);
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
      const { container } = render(<A2UIStepRenderer document={step} specVersion={specVersion} />);
      const wrapper = fieldWrapper(container, control.name);

      // The required STATE, which is what assistive technology reports. RAC sets it
      // from `isRequired` on whatever element carries the control's semantics: the
      // input for the text-shaped controls, each date segment for the DatePicker,
      // the group for the RadioGroup, and each item for the CheckboxGroup, whose
      // group element cannot carry it. Searching the whole field wrapper is what
      // lets one assertion cover all four placements.
      const required = wrapper.querySelectorAll("[aria-required='true'], [required]");
      expect(required.length > 0).toBe(true);

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
    // One case per control TYPE: the property is per-control-type and the corpus
    // repeats each type across generations and forms, so rendering all 70-odd
    // cases here would cost seconds to prove nothing the first of each does not.
    // The per-case assertions above already cover every case individually.
    const byType = new Map(cases.map((c) => [c.control.type, c]));
    const leaking = new Set<string>();
    for (const { step, specVersion, control } of byType.values()) {
      const { container } = render(<A2UIStepRenderer document={step} specVersion={specVersion} />);
      const wrapper = fieldWrapper(container, control.name);
      const marker = markersIn(wrapper)[0];
      if (marker?.getAttribute("aria-hidden") !== "true") leaking.add(control.type);
    }
    expect(leaking).toEqual(MARKER_IN_ACCESSIBLE_NAME);
  });

  it("pins exactly which controls convey required only visually", () => {
    // The companion exact-set assertion to the one above, and the reason the
    // per-case check is a plain `toBe(true)`: the exception is stated once, here,
    // where a regression names the control rather than reddening seventy cases.
    // One case per control TYPE, for the reason given above.
    const byType = new Map(cases.map((c) => [c.control.type, c]));
    const visualOnly = new Set<string>();
    for (const { step, specVersion, control } of byType.values()) {
      const { container } = render(<A2UIStepRenderer document={step} specVersion={specVersion} />);
      const wrapper = fieldWrapper(container, control.name);
      const required = wrapper.querySelectorAll("[aria-required='true'], [required]");
      if (required.length === 0) visualOnly.add(control.type);
    }
    expect(visualOnly).toEqual(REQUIRED_STATE_NOT_EXPOSED);
  });
});
