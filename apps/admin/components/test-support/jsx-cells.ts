/* Preserve offsets while masking, and leave template-expression holes visible because they contain code
   the scan must inspect. */
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

function endOfComment(source: string, at: number, kind: string): number {
  if (kind === "//") {
    const newline = source.indexOf("\n", at);
    return newline === -1 ? source.length : newline;
  }
  const close = source.indexOf("*/", at + 2);
  return close === -1 ? source.length : close + 2;
}

/* Mask template text in runs while preserving expressions inside interpolation holes for scanning. */
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

export interface CellRange {
  readonly tag: "td" | "th";
  readonly start: number;
  readonly end: number;
}

/* Scan opening tags brace-aware because attribute expressions may contain their own greater-than sign. */
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

export interface CellExpression {
  readonly masked: string;
  readonly text: string;
  readonly isChild: boolean;
}

/* Classify a brace group as an attribute only after =; everything else is a rendered child. */
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

function previousSignificant(masked: string, at: number): string {
  for (let back = at - 1; back >= 0; back -= 1) {
    const ch = masked[back];
    if (ch !== undefined && ch.trim() !== "") return ch;
  }
  return "";
}
