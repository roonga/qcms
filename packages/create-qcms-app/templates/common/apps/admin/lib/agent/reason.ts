/* The card's quoted reason is model prose, so it is shown as plain text and never rendered as markup
   (SEC-17 §8d). Flatten the syntax a model writes anyway, and cut on a word boundary. */

export const REASON_CHARS = 280;

const ELLIPSIS = "…";

const MARKER = /^ {0,3}([-*+]|\d{1,3}[.)]) */;

/**
 * Inline constructs the assistant's own markdown subset allows, reduced to their text. An
 * underscore pair counts only between non-word characters, as CommonMark has it: a branded
 * id is the common case here, and `q_insurance_provider` is not emphasis.
 */
function inline(text: string): string {
  return text
    .replaceAll(/`+/g, "")
    .replaceAll(/!\[/g, "[")
    .replaceAll(/\[([^\][]*)\]\(([^()]*)\)/g, "$1")
    .replaceAll(/\*\*([^*]*)\*\*/g, "$1")
    .replaceAll(/\*([^*]*)\*/g, "$1")
    .replaceAll(/(^|\W)__([^_]*)__(?=\W|$)/g, "$1$2")
    .replaceAll(/(^|\W)_([^_]*)_(?=\W|$)/g, "$1$2")
    .replaceAll(/^ {0,3}#{1,6} +/g, "")
    .replaceAll(/^ {0,3}> ?/g, "")
    .trim();
}

/**
 * A list becomes a comma-separated run, so a quote never shows a bare marker: a line that
 * carried one joins the previous item with a comma, and an item with no text at all is
 * dropped rather than left as punctuation.
 */
function flatten(text: string): string {
  const parts: string[] = [];
  let listing = false;
  for (const line of text.split(/\r?\n/)) {
    const marked = MARKER.test(line);
    const body = inline(marked ? line.replace(MARKER, "") : line);
    if (body === "") {
      listing = listing && marked;
      continue;
    }
    if (marked) {
      // A comma only where it continues a run of items; after a finished sentence it would
      // read as punctuation the writer did not use.
      const continues = listing && !/[.!?]$/.test(parts.at(-1) ?? "");
      parts.push(`${continues ? ", " : " "}${body}`);
      listing = true;
    } else {
      parts.push(` ${body}`);
      listing = false;
    }
  }
  return parts.join("").replaceAll(/\s+/g, " ").trim();
}

/* Separators that are never an ending. A full stop is one, so it is not in either set. */
const SEPARATORS: readonly string[] = [" ", ",", ";", ":", "*", "+", "-", "–"];
const TRAILING: ReadonlySet<string> = new Set(SEPARATORS);
/* Mid-cut, a full stop is a list's punctuation rather than a sentence's end. */
const CUT: ReadonlySet<string> = new Set([...SEPARATORS, "."]);

/* A loop rather than an anchored quantifier, which backtracks over a long tail of spaces. */
function trimEnd(text: string, drop: ReadonlySet<string>): string {
  let end = text.length;
  while (end > 0 && drop.has(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/* Cut at the last sentence end, else the last space, so a quote never breaks mid-word. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > max / 2) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  const kept = trimEnd(space > 0 ? head.slice(0, space) : head, CUT);
  return kept === "" ? "" : `${kept}${ELLIPSIS}`;
}

/** The reason as a card may quote it, or `undefined` when there is nothing to quote. */
export function plainQuote(reason: string | undefined, max: number): string | undefined {
  if (reason === undefined) return undefined;
  const shortened = shorten(flatten(reason), max);
  const quoted = shortened.endsWith(ELLIPSIS) ? shortened : trimEnd(shortened, TRAILING);
  return quoted === "" ? undefined : quoted;
}
