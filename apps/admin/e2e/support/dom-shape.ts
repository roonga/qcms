import type { Locator } from "@playwright/test";

// Generated react-aria identities and measured styles differ between otherwise identical renders.

export interface DomShape {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly DomShape[];
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

type HeadingTag = (typeof HEADING_TAGS)[number];

function isHeadingTag(tag: string): tag is HeadingTag {
  return (HEADING_TAGS as readonly string[]).includes(tag);
}

// Adjust the expected heading offset instead of erasing tags, so incorrect embedding still fails parity.
export function withDemotedHeadings(shape: DomShape, by: number): DomShape {
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

// Positional instance IDs preserve instance count, order and placement while ignoring session-specific identities.
export function withNormalizedInstanceIds(shape: DomShape): DomShape {
  const seen = new Map<string, string>();
  const rewrite = (value: string): string =>
    value.replaceAll(/ins_[a-z0-9_]+/g, (found) => {
      const known = seen.get(found);
      if (known !== undefined) return known;
      const placeholder = `ins_instance_${String(seen.size + 1)}`;
      seen.set(found, placeholder);
      return placeholder;
    });
  const walk = (node: DomShape): DomShape => ({
    ...node,
    attrs: Object.fromEntries(
      Object.entries(node.attrs).map(([name, value]) => [name, rewrite(value)]),
    ),
    children: node.children.map(walk),
  });
  return walk(shape);
}

export function headingTags(shape: DomShape): string[] {
  const own = isHeadingTag(shape.tag) ? [shape.tag] : [];
  return [...own, ...shape.children.flatMap((child) => headingTags(child))];
}

// Pass these into evaluate because browser-side code cannot close over module scope.
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

export async function domShape(locator: Locator): Promise<DomShape> {
  return locator.evaluate((root: Element, dropped: string[]): DomShape => {
    const drop = new Set(dropped);
    // Use bounded identity checks; wildcard alternations can backtrack on large attribute values.
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
