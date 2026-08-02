import type { Locator } from "@playwright/test";

/**
 * A normalized snapshot of a rendered subtree, for the preview-fidelity assertion
 * (task 034, exit criterion 3).
 *
 * ## Why a normalized shape rather than `innerHTML`
 *
 * The claim under test is that the admin's preview of a step and the portal's rendering of
 * the same published document are *the same DOM*. Raw HTML cannot express that, because
 * react-aria mints a fresh id per render and threads it through `id`, `for`,
 * `aria-labelledby`, `aria-describedby` and friends. Two identical renders therefore differ
 * in raw HTML on every run, in both apps, always.
 *
 * So the comparison drops exactly the attributes that carry a generated identity and keeps
 * everything that carries meaning: the element, its classes, its semantic and state
 * attributes, and its text. What survives is what a respondent and an author would each
 * see and what a screen reader would each announce. A real divergence - a different
 * control, a missing question, a changed label, a different input type, a lost `required` -
 * moves this shape.
 *
 * `style` goes too: it is where react-aria writes measured positions.
 */

/** One element in the normalized tree. */
export interface DomShape {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly DomShape[];
}

/**
 * Attributes dropped wholesale: each is either a generated identity or a reference to one.
 * Kept in the browser-side function below, which cannot close over module scope.
 */
const DROPPED = [
  "id",
  "for",
  "form",
  "style",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
  "aria-details",
  "aria-errormessage",
  "list",
];

/** Read the normalized shape of the subtree `locator` points at. */
export async function domShape(locator: Locator): Promise<DomShape> {
  return locator.evaluate((root: Element, dropped: string[]): DomShape => {
    const drop = new Set(dropped);
    // A react-aria generated id looks like `react-aria-«r3»` or `:r7:`; any attribute
    // value holding one is an identity reference this comparison must not depend on.
    // Written without a quantifier inside an alternation: `«.*»` backtracks super-linearly
    // and the lint gate rejects it, rightly, for something that runs over every node.
    const generated = (value: string): boolean =>
      value.includes("react-aria") || value.includes("\u00ab") || /^:r[0-9a-z]+:$/.test(value);

    function shapeOf(element: Element): DomShape {
      const attrs: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        if (drop.has(attribute.name)) continue;
        if (attribute.name.startsWith("data-react")) continue;
        if (generated(attribute.value)) continue;
        attrs[attribute.name] = attribute.value;
      }
      const children: DomShape[] = [];
      for (const child of Array.from(element.children)) children.push(shapeOf(child));
      // Own text only (the concatenation of direct text-node children), so a parent does
      // not restate everything its descendants already contributed.
      const text = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => (node.textContent ?? "").trim())
        .filter((value) => value !== "")
        .join(" ");
      return { tag: element.tagName.toLowerCase(), attrs, text, children };
    }

    return shapeOf(root);
  }, DROPPED);
}
