/**
 * A source scanner for table-cell render positions (issue #582).
 *
 * `app/(shell)/table-cell-rules.test.ts` needs to ask one question of every table in the
 * admin: what does this cell RENDER? Not what the file mentions - these files mention ids
 * and timestamps constantly, in `key=`, in `data-*`, in an `aria-label`, in a handler - but
 * what ends up as text in a `<td>` or a `<th>`. A grep cannot tell those apart, and telling
 * them apart is the whole check, so this module does the small amount of scanning that
 * makes the difference visible.
 *
 * ## Why a scanner rather than a parser
 *
 * The TypeScript compiler API would answer this exactly, and it is not a dependency of
 * this app: the root declares `typescript` for `tsc`, and the scaffolded twin gets it from
 * `ROOT_PROVIDED_DEV_DEPENDENCIES` in the template sync. Importing it from here would be a
 * phantom dependency in the monorepo and a new one in the template. What the check needs is
 * narrower than a parser anyway, and the narrowing is what makes the scanning tractable:
 * **inside a table cell, there is no statement-level JavaScript.** Every brace group in a
 * cell is either an attribute value (`onPress={() => …}`, `iso={row.createdAt}`) or a
 * rendered child, and the character before the brace says which. Outside a cell, where that
 * property does not hold, this module reads nothing.
 *
 * ## What it can and cannot see
 *
 * It sees a value rendered in the cell's own JSX, which is how all nine tables render one.
 * It does NOT see through a component boundary: a cell that delegates to a component
 * defined in another file renders whatever that component renders, and the scan stops at
 * the call. That hole is bounded by the check's other half, which asserts that the id and
 * timestamp components are the only ones that render those values at all, and it is named
 * here rather than left for a reader to discover.
 */

/**
 * Blank out the contents of comments and string literals, preserving every offset.
 *
 * Offsets are preserved so a caller can slice the ORIGINAL source with positions found in
 * the masked copy: the masked text is for finding structure, and the original is what any
 * assertion should read and report. A template literal keeps its `${…}` holes unmasked,
 * because an expression inside one is code the scan still has to see.
 *
 * The characters that matter to the scan - `<`, `>`, `{`, `}` - cannot survive inside a
 * masked region, which is the property that makes an `https://` inside a string, a `>` in
 * an aria-label, or a `{` inside a comment harmless.
 */
export function maskLiteralsAndComments(source: string): string {
  const out = [...source];
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== "\n") out[at] = " ";
    }
  };
  let at = 0;
  while (at < source.length) {
    const two = source.slice(at, at + 2);
    if (two === "//" || two === "/*") {
      const stop = endOfComment(source, at, two);
      blank(at, stop);
      at = stop;
      continue;
    }
    const quote = source[at];
    if (quote === '"' || quote === "'" || quote === "`") {
      at = maskStringFrom(source, at, quote, blank);
      continue;
    }
    at += 1;
  }
  return out.join("");
}

/** Where a comment that starts at `at` ends: the closing delimiter, or the newline. */
function endOfComment(source: string, at: number, kind: string): number {
  if (kind === "//") {
    const newline = source.indexOf("\n", at);
    return newline === -1 ? source.length : newline;
  }
  const close = source.indexOf("*/", at + 2);
  return close === -1 ? source.length : close + 2;
}

/**
 * Mask one string literal from its opening quote, returning the offset just past its close.
 *
 * A template literal is masked in runs: each run of text is blanked and each `${…}` hole is
 * stepped over unmasked, because a hole holds code the scan still has to see.
 */
function maskStringFrom(
  source: string,
  open: number,
  quote: string,
  blank: (from: number, to: number) => void,
): number {
  let runStart = open;
  let at = open + 1;
  while (at < source.length) {
    const ch = source[at];
    if (ch === "\\") {
      at += 2;
      continue;
    }
    if (ch === quote) {
      blank(runStart, at + 1);
      return at + 1;
    }
    if (quote === "`" && ch === "$" && source[at + 1] === "{") {
      blank(runStart, at);
      const close = matchingBrace(source, at + 1);
      if (close === -1) return source.length;
      at = close + 1;
      runStart = at;
      continue;
    }
    at += 1;
  }
  blank(runStart, source.length);
  return source.length;
}

/** The offset of the `}` closing the brace group that opens at `open`, or -1. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === "{") depth += 1;
    else if (source[at] === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** One `<td>` or `<th>` in a source file: where its children start and end. */
export interface CellRange {
  readonly tag: "td" | "th";
  readonly start: number;
  readonly end: number;
}

/**
 * Every table cell in a file, as a range over the source that holds its children.
 *
 * Cells do not nest, so the closing tag is simply the next one of its kind. An opening tag
 * is scanned brace-aware, because an attribute value can hold a `>` of its own.
 */
export function tableCells(masked: string): CellRange[] {
  const cells: CellRange[] = [];
  const opening = /<(td|th)(?=[\s/>])/g;
  let match = opening.exec(masked);
  while (match !== null) {
    const tag = match[1] === "th" ? "th" : "td";
    const open = endOfOpeningTag(masked, match.index);
    const close = masked.indexOf(`</${tag}>`, open);
    if (open !== -1 && close !== -1) cells.push({ tag, start: open + 1, end: close });
    match = opening.exec(masked);
  }
  return cells;
}

/** The offset of the `>` that ends an opening tag starting at `start`. */
function endOfOpeningTag(masked: string, start: number): number {
  let depth = 0;
  for (let at = start; at < masked.length; at += 1) {
    const ch = masked[at];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return at;
  }
  return -1;
}

/** A leaf brace group inside a cell: its source text, and what position it occupies. */
export interface CellExpression {
  /** The masked text, which is what a rule should MATCH: no string or comment survives. */
  readonly masked: string;
  /** The original text, which is what a failure should REPORT. */
  readonly text: string;
  readonly isChild: boolean;
}

/**
 * The leaf brace groups inside one cell, each labelled attribute or rendered child.
 *
 * A group is an ATTRIBUTE when the nearest non-whitespace character before it is `=`, and a
 * rendered CHILD otherwise. That test is exhaustive inside a cell and nowhere else, which
 * is why this function takes a cell range rather than a file: outside one, a brace can also
 * open a block, an object literal or a destructuring pattern, and none of those are
 * distinguishable this cheaply.
 *
 * LEAF is the load-bearing word. A group holding JSX of its own - `{isRevocable(state) && (
 * <Button onPress={…}>{t("…")}</Button>)}` - is recursed into rather than reported whole,
 * so the handler inside it stays an attribute and only the text the `<Button>` renders is a
 * child. Reporting such a group whole was this scanner's first draft and it made every
 * conditional subtree a false finding.
 *
 * Matching is done against the MASKED text, so a catalog key that happens to read
 * `ops.responses.column.sessionId` is not an id and a `{/* … *\/}` comment is not an
 * expression. The original text rides along for the failure message.
 */
export function cellExpressions(source: string, masked: string, cell: CellRange): CellExpression[] {
  return groupsIn(source, masked, cell.start, cell.end);
}

const JSX_TAG = /<\/?[A-Za-z]/;

function groupsIn(source: string, masked: string, from: number, to: number): CellExpression[] {
  const found: CellExpression[] = [];
  let at = from;
  while (at < to) {
    if (masked[at] !== "{") {
      at += 1;
      continue;
    }
    const close = matchingBrace(masked, at);
    const end = close === -1 || close > to ? to : close;
    const inner = masked.slice(at + 1, end);
    if (JSX_TAG.test(inner)) {
      found.push(...groupsIn(source, masked, at + 1, end));
    } else {
      found.push({
        masked: inner,
        text: source.slice(at + 1, end),
        isChild: previousSignificant(masked, at) !== "=",
      });
    }
    at = end + 1;
  }
  return found;
}

/** The nearest non-whitespace character before `at`, or the empty string. */
function previousSignificant(masked: string, at: number): string {
  for (let back = at - 1; back >= 0; back -= 1) {
    const ch = masked[back];
    if (ch !== undefined && ch.trim() !== "") return ch;
  }
  return "";
}
