import { within } from "@testing-library/react";
import axe from "axe-core";
import { computeAccessibleName } from "dom-accessibility-api";

/**
 * A deterministic accessibility-tree outline built from testing-library role
 * queries (NOT a DOM snapshot): every landmark role a step exposes, paired with
 * its computed accessible name, grouped by role in a fixed order. This is the
 * conformance snapshot - it regresses if a control loses its label, a heading
 * level changes, or a role disappears.
 */
const ROLE_ORDER = [
  "heading",
  "radiogroup",
  "radio",
  "group",
  "checkbox",
  "textbox",
  "spinbutton",
  "combobox",
] as const;

export interface A11yNode {
  readonly role: string;
  readonly name: string;
}

export function a11yOutline(container: HTMLElement): A11yNode[] {
  const scope = within(container);
  const nodes: A11yNode[] = [];
  for (const role of ROLE_ORDER) {
    for (const element of scope.queryAllByRole(role)) {
      const name = computeAccessibleName(element);
      if (role === "group" && name.trim() === "") {
        // Skip unlabelled structural groups (e.g. NumberField's stepper group);
        // labelled groups (CheckboxGroup) carry the question label.
        continue;
      }
      if (role === "heading") {
        const level =
          /^H(\d)$/.exec(element.tagName)?.[1] ?? element.getAttribute("aria-level") ?? "";
        nodes.push({ role: `heading${level}`, name });
        continue;
      }
      nodes.push({ role, name });
    }
  }
  return nodes;
}

/**
 * WCAG 2.1/2.2 A + AA axe violations for a rendered container. Scoped to the
 * WCAG success-criteria rules; best-practice/page-level rules (region,
 * page-has-heading-one, …) do not apply to a form fragment. color-contrast is
 * reported as `incomplete` under jsdom (no layout) and never as a violation.
 *
 * ## Why label-in-name is NOT enabled here (issue #943)
 *
 * `label-content-name-mismatch` (WCAG 2.5.3) joined the two browser sweeps
 * (`apps/portal/e2e/a11y-axe.pw.ts`, `apps/admin/e2e/a11y-axe.pw.ts`) through the
 * same `rules[id].enabled` hook that would work here, and it is deliberately not
 * added to this list: under jsdom the rule cannot reach a verdict at all. Its
 * evaluate asks for the visible text with `ignoreIconLigature`, which measures
 * glyphs on a canvas, and jsdom's `getContext()` is unimplemented - so every node
 * it matches comes back as `incomplete` carrying "Axe encountered an error",
 * whatever the markup says. Measured on the exact pre-#879 pin markup, which the
 * browser sweeps report as a violation: here it is one `incomplete` node and no
 * violation. Enabling it would therefore install a rule that can only ever be
 * silent, which reads like coverage and is not, so it stays with color-contrast as
 * a browser-only check. The jsdom layer that DOES pin this class is
 * `apps/admin/components/forms/pin-label-in-name.test.tsx`, which compares the
 * computed name against the rendered text directly and needs no canvas.
 */
export async function axeViolations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
    // color-contrast needs real layout/canvas (unavailable in jsdom) - it is a
    // browser-only check that rides on Playwright + the Lighthouse gate (030).
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}
