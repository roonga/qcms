import { render } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { instanceLabelFor, qualifiedFieldName } from "./repeat/repeat-node.ts";
import { cellLabelFor } from "./repeat/repeat-table-node.ts";
import { loadGoldenSteps, syntheticRoster } from "./test-support/golden.ts";

/**
 * A required question is perceivable as required before its error fires.
 *
 * The marker is rendered by each vendored control inside its own label rather than by
 * the adapter, so this is a property of the vendored set: a control that ships without
 * one is silently missing it for every required question of that type.
 *
 * The set of required controls is derived from the golden corpus rather than written
 * down, so a generation that introduces a required question of a new type is covered
 * the day it lands instead of falling outside a hard-coded list.
 */

interface RequiredControl {
  readonly type: string;
  readonly label: string;
  /** The `data-qcms-field` value the control renders under. */
  readonly name: string;
}

/**
 * What a group puts round its members: which instance they render under, and, in the
 * table presentation, the row label their own label is prefixed with.
 */
interface GroupScope {
  readonly instanceId?: string;
  /** The resolved row label ("Vehicle 1"), present for a `table` group only. */
  readonly rowLabel?: string;
}

/**
 * Every `isRequired` node of one compiled step, with the label it renders and the name
 * it renders under.
 *
 * A required question inside a repeating group renders once per live instance under
 * its qualified name, so the walk carries the instance of whichever group it is
 * inside: the property pinned here has to hold for a control inside an instance card
 * too, and it would silently stop being checked if a group's members were skipped.
 *
 * The table presentation also rewrites a member's label to its cell's own name, since
 * a real label per cell is the only encoding that survives the card reflow, so the
 * scope carries the row label and the expectation is the label the renderer emits
 * rather than the one the template stored.
 */
function requiredControlsIn(
  node: unknown,
  rosters: Readonly<Record<string, readonly string[]>>,
  scope: GroupScope = {},
  found: RequiredControl[] = [],
): RequiredControl[] {
  if (Array.isArray(node)) {
    for (const child of node) requiredControlsIn(child, rosters, scope, found);
    return found;
  }
  if (typeof node !== "object" || node === null) return found;
  const record = node as Record<string, unknown>;
  const props = propsOf(record);
  const inner = groupScopeOf(record, props, rosters) ?? scope;
  const control = requiredControlOf(record, props, inner);
  if (control !== undefined) found.push(control);
  for (const value of Object.values(record)) requiredControlsIn(value, rosters, inner, found);
  return found;
}

function propsOf(record: Record<string, unknown>): Record<string, unknown> {
  const props = record["props"];
  return typeof props === "object" && props !== null ? (props as Record<string, unknown>) : {};
}

/** The scope of the group this node is: its first live instance, and the row label a
 * table presentation prefixes each cell's label with. */
function groupScopeOf(
  record: Record<string, unknown>,
  props: Record<string, unknown>,
  rosters: Readonly<Record<string, readonly string[]>>,
): GroupScope | undefined {
  if (record["type"] !== "RepeatGroup" || typeof props["groupId"] !== "string") return undefined;
  const roster = rosters[props["groupId"]] ?? [];
  const instanceId = roster.length > 0 ? roster[0] : undefined;
  const presentation: unknown = props["presentation"];
  const template: unknown = props["instanceLabel"];
  // `typeof` first so the comparison is string-to-string: a node's props are
  // `unknown`-valued and comparing that to a literal is what the lint refuses.
  const isTable = typeof presentation === "string" && presentation === "table";
  const rowLabel =
    isTable && typeof template === "string" ? instanceLabelFor(template, 1) : undefined;
  return {
    ...(instanceId === undefined ? {} : { instanceId }),
    ...(rowLabel === undefined ? {} : { rowLabel }),
  };
}

/** This node as a required control, or `undefined` when it is not one. */
function requiredControlOf(
  record: Record<string, unknown>,
  props: Record<string, unknown>,
  scope: GroupScope,
): RequiredControl | undefined {
  if (props["isRequired"] !== true) return undefined;
  const type = record["type"];
  const label = props["label"];
  const name = props["name"];
  if (typeof type !== "string" || typeof label !== "string" || typeof name !== "string") {
    return undefined;
  }
  const { instanceId, rowLabel } = scope;
  return {
    type,
    label: rowLabel === undefined ? label : cellLabelFor(rowLabel, label),
    name: instanceId === undefined ? name : qualifiedFieldName(instanceId, name),
  };
}

interface Case {
  readonly label: string;
  readonly step: A2UIStepDocument;
  readonly specVersion: string;
  readonly control: RequiredControl;
  /** The one-instance roster a document carrying a repeating group is rendered with. */
  readonly rosters: Readonly<Record<string, readonly string[]>>;
}

const cases: Case[] = loadGoldenSteps().flatMap((step) => {
  const rosters = syntheticRoster(step.document);
  return requiredControlsIn(step.document, rosters).map((control) => ({
    label: `${step.version}/${step.form}/${step.stepId} ${control.type} ${control.name}`,
    step: step.document,
    specVersion: step.specVersion,
    control,
    rosters,
  }));
});

/**
 * The controls whose marker is not hidden from assistive technology: none of them.
 *
 * Every vendored control wraps the marker in `aria-hidden`, so a screen reader
 * announces the field's required state rather than a literal asterisk. One did not,
 * and its accessible name ended in an asterisk; ADR-22 freezes the vendored tree, so
 * it was fixed upstream.
 *
 * The set stays, empty, rather than being deleted with the assertions reading it: it
 * is what makes "no control leaks its marker" an exhaustive claim over the
 * corpus-derived set, and a control that regresses names itself in a diff.
 */
const MARKER_IN_ACCESSIBLE_NAME = new Set<string>();

/**
 * The controls that convey required only visually: none of them.
 *
 * A `CheckboxGroup` once got only `data-required`, a styling hook invisible to
 * assistive technology, because the vendored `Checkbox` defaulted `isRequired` to
 * `false` and react-aria resolves a group item's required state as
 * `props.isRequired ?? state.isRequired`, so the literal won over the group.
 *
 * ARIA does not allow `aria-required` on `role="group"`, so each checkbox carries it
 * instead, for as long as nothing in the group is selected, which is react-aria's own
 * encoding of "at least one" and why the assertion below searches the whole field
 * wrapper rather than the group element.
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
    (_label, { step, specVersion, control, rosters }) => {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} repeat={{ rosters }} />,
      );
      const markers = markersIn(fieldWrapper(container, control.name));
      expect(markers).toHaveLength(1);
      // Inside the label, beside the label text: a marker rendered outside the label
      // span would satisfy "a marker exists" while reading differently to a screen
      // reader walking the label, which is why the adapter seam was rejected.
      expect(markers[0]?.parentElement?.textContent).toBe(`${control.label} *`);
    },
  );

  it.each(cases.map((c) => [c.label, c] as const))(
    "%s conveys required in the accessibility tree",
    (_label, { step, specVersion, control, rosters }) => {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} repeat={{ rosters }} />,
      );
      const wrapper = fieldWrapper(container, control.name);

      // The required state, which is what assistive technology reports. RAC sets it on
      // whatever element carries the control's semantics, which differs per control
      // type, so searching the whole field wrapper is what lets one assertion cover
      // every placement.
      const required = wrapper.querySelectorAll("[aria-required='true'], [required]");
      expect(required.length > 0).toBe(true);

      // And the name still reads as the question, with the asterisk hidden.
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
    // One case per control type: the property is per type and the corpus repeats each
    // type across generations and forms, so rendering every case would cost seconds to
    // prove nothing the first of each does not.
    const byType = new Map(cases.map((c) => [c.control.type, c]));
    const leaking = new Set<string>();
    for (const { step, specVersion, control, rosters } of byType.values()) {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} repeat={{ rosters }} />,
      );
      const wrapper = fieldWrapper(container, control.name);
      const marker = markersIn(wrapper)[0];
      if (marker?.getAttribute("aria-hidden") !== "true") leaking.add(control.type);
    }
    expect(leaking).toEqual(MARKER_IN_ACCESSIBLE_NAME);
  });

  it("pins exactly which controls convey required only visually", () => {
    // The companion exact-set assertion, and the reason the per-case check is a plain
    // `toBe(true)`: the exception is stated once, here, where a regression names the
    // control rather than reddening every case.
    const byType = new Map(cases.map((c) => [c.control.type, c]));
    const visualOnly = new Set<string>();
    for (const { step, specVersion, control, rosters } of byType.values()) {
      const { container } = render(
        <A2UIStepRenderer document={step} specVersion={specVersion} repeat={{ rosters }} />,
      );
      const wrapper = fieldWrapper(container, control.name);
      const required = wrapper.querySelectorAll("[aria-required='true'], [required]");
      if (required.length === 0) visualOnly.add(control.type);
    }
    expect(visualOnly).toEqual(REQUIRED_STATE_NOT_EXPOSED);
  });
});
