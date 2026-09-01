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

/** The heading tags a rendered document can carry. */
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

type HeadingTag = (typeof HEADING_TAGS)[number];

function isHeadingTag(tag: string): tag is HeadingTag {
  return (HEADING_TAGS as readonly string[]).includes(tag);
}

/**
 * Return `shape` with every heading tag lowered by `by` levels, clamped at `h6`.
 *
 * ## Why the fidelity comparison needs this
 *
 * The admin's preview and the portal's rendering are the same document through the same
 * renderer, and the parity test says so by comparing their DOM. Since issue #537 there is
 * exactly ONE deliberate difference between them: an embedding host passes
 * `headingLevelOffset={1}`, so the document's `h1` renders as `h2` inside a page that
 * already has an `h1` of its own. Without that the admin routes had two top-level
 * headings, which is a document-outline defect and made a heading-by-level query ambiguous
 * on the route.
 *
 * The offset is applied to the RESPONDENT's shape before comparing, rather than erased
 * from both sides. Erasing it - mapping every heading to one sentinel tag - would also
 * stop the test noticing a preview that demoted by two levels, or by none, or that turned
 * a heading into a `<p>`. Demoting the expected side keeps the assertion total: the trees
 * must still match element for element, and the offset must be exactly the one the host
 * asked for.
 */
export function withDemotedHeadings(shape: DomShape, by: number): DomShape {
  // `h6` spelled out rather than read back off the array: the index access is
  // `HeadingTag | undefined` under `noUncheckedIndexedAccess`, and a fallback that needs
  // its own fallback reads worse than the literal it would resolve to.
  const tag = isHeadingTag(shape.tag)
    ? (HEADING_TAGS[Math.min(HEADING_TAGS.indexOf(shape.tag) + by, HEADING_TAGS.length - 1)] ??
      "h6")
    : shape.tag;
  return {
    ...shape,
    tag,
    children: shape.children.map((child) => withDemotedHeadings(child, by)),
  };
}

/** Every heading tag in `shape`, in document order. */
export function headingTags(shape: DomShape): string[] {
  const own = isHeadingTag(shape.tag) ? [shape.tag] : [];
  return [...own, ...shape.children.flatMap((child) => headingTags(child))];
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
