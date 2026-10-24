import { within } from "@testing-library/react";
import axe from "axe-core";
import { computeAccessibleName } from "dom-accessibility-api";

// Role queries rather than a DOM snapshot, so the conformance snapshot regresses on a
// lost label, a changed heading level or a missing role, and on nothing else.
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
        // Unlabelled groups are structural; a labelled one carries the question label.
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

// Scoped to the success-criteria rules, because the best-practice and page-level ones
// do not apply to a form fragment.
export async function axeViolations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
    // color-contrast needs real layout, which jsdom has none of, so it rides on the
    // browser gate instead.
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}
