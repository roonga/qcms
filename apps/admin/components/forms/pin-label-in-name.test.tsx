import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n/en";

import type { DraftForm, DraftStep, PinnableQuestion } from "../../lib/forms/types.ts";

import { StepEditor } from "./step-editor.tsx";

/**
 * WCAG 2.5.3 label-in-name, for the step editor's own controls (issue #879).
 *
 * The criterion is one sentence: where a control carries visible text, that text is part
 * of its accessible name. The failure it exists for is not theoretical here. The pin's
 * version control paints `v3` and was named "Move pin for q_at_fault_accident", so the
 * two had no word in common: a speech-input user saying "click v3" moved nothing, and a
 * screen-reader user heard a name that no sighted colleague could point at. The row has
 * two other controls (the grip, the id's copy button) and both are icon-only, which is
 * why the gap could sit in the one control of the three that does show text.
 *
 * ## Why the assertion is a sweep rather than one string
 *
 * A test naming the version trigger alone would pin this instance and nothing else, and
 * the shape recurs by default: `kit.Menu` turns `triggerLabel` into an `aria-label`
 * whenever it is given alongside a `trigger`, and an `aria-label` REPLACES the content it
 * sits on in the name computation. So every button this component renders is checked, and
 * the rule is checked in the direction WCAG states it plus the stronger one speech input
 * actually needs: the name must START with the visible text, so the visible text is a
 * pronounceable prefix rather than a fragment buried mid-sentence.
 *
 * Controls with no visible text of their own (an `aria-hidden` glyph and nothing else) are
 * outside the criterion and are skipped - explicitly, and by reading the rendered tree
 * rather than by listing them here, so a glyph that grows a caption later is swept in
 * without anyone remembering to add it.
 *
 * ## Why this layer
 *
 * The accessible name is computed from the rendered tree, so this needs a DOM: the
 * `name` option of a testing-library role query IS the computed name (dom-accessibility-api
 * under it), which is the same computation `getByRole` uses in Playwright. jsdom carries
 * no layout, and nothing here needs any (ADR-23): a name is not a measurement. The browser
 * gate that walks this control lives in `apps/admin/e2e/pin-grid.pw.ts`.
 */

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      { version: 1, status: "published", definition: DEFINITION },
      { version: 3, status: "published", definition: DEFINITION },
    ],
  },
];

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [{ questionId: "q_at_fault_accident", version: 3 }],
};

const DRAFT: DraftForm = {
  formId: "frm_vehicle_insurance",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [STEP],
  rules: [],
};

function renderStep(): HTMLElement {
  return render(
    <StepEditor
      draft={DRAFT}
      step={STEP}
      library={{ ok: true, data: LIBRARY }}
      issues={[]}
      onAddPins={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
    />,
  ).container;
}

/**
 * What a sighted user can read on the control: its text with every `aria-hidden` subtree
 * removed, since those contribute nothing to the name and nothing legible to a person.
 */
function visibleText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** `text` as a pattern matching an accessible name that begins with it. */
function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

describe("the step editor's controls satisfy label-in-name (WCAG 2.5.3)", () => {
  it("names the pin's version control with the version it displays", () => {
    const container = renderStep();
    const scope = within(container);

    // The visible text, from the catalog rather than typed out: this is the criterion's
    // "visible text", so reading it from anywhere else would let the two drift.
    const visible = t("forms.step.pinVersion", { version: 3 });
    const trigger = scope.getByRole("button", { name: startsWith(visible) });

    expect(visibleText(trigger)).toBe(visible);
    // And the name still says which pin it moves, which is why it carries a label at all:
    // "v3" alone repeats down a column of pins. A role query with a plain string matches
    // the WHOLE computed name, so this is the exact name and not a fragment of it.
    expect(
      scope.getByRole("button", {
        name: t("forms.step.movePin", { versionLabel: visible, questionId: "q_at_fault_accident" }),
      }),
    ).toBe(trigger);
  });

  it("starts every visible-text control's accessible name with that text", () => {
    const container = renderStep();
    const scope = within(container);
    const checked: string[] = [];

    for (const button of scope.getAllByRole("button")) {
      const visible = visibleText(button);
      // No visible text: outside the criterion (an icon-only control is named by its
      // label alone). Asserted as a skip rather than a silent one.
      if (visible === "") {
        expect(button.getAttribute("aria-label")).not.toBe(null);
        continue;
      }
      expect(scope.getAllByRole("button", { name: startsWith(visible) })).toContain(button);
      checked.push(visible);
    }

    // The sweep is only evidence while it has something to sweep: a rendering that
    // stopped showing text on any control would otherwise pass by finding nothing.
    expect(checked).toContain(t("forms.step.pinVersion", { version: 3 }));
  });
});
