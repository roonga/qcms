/* The card's quoted reason is model prose, so it is shown as plain text and never rendered as markup
   (SEC-17 §8d). Flatten the syntax a model writes anyway, and cut on a line or a sentence. */

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
    // Whatever emphasis the pairs above could not resolve is still a marker, never a word.
    .replaceAll(/\*+/g, "")
    .replaceAll(/(^|\W)__([^_]*)__(?=\W|$)/g, "$1$2")
    .replaceAll(/(^|\W)_([^_]*)_(?=\W|$)/g, "$1$2")
    .replaceAll(/^ {0,3}#{1,6} +/g, "")
    .replaceAll(/^ {0,3}> ?/g, "")
    .trim();
}

/** One line of the quote per line the writer wrote, grouped by the blank lines between them. */
function paragraphs(text: string): readonly (readonly string[])[] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "") {
      if (current.length > 0) blocks.push(current);
      current = [];
      continue;
    }
    const body = inline(MARKER.test(raw) ? raw.replace(MARKER, "") : raw).replaceAll(/\s+/g, " ");
    if (body !== "") current.push(body);
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
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

const ENDS_SENTENCE = /[.!?]$/;

/* A quote that stopped short says so however it was cut: a full stop at the end of a clipped
   quote reads as the writer's own last word. */
function marked(text: string): string {
  if (text === "") return "";
  return ENDS_SENTENCE.test(text) ? `${text} ${ELLIPSIS}` : `${trimEnd(text, CUT)}${ELLIPSIS}`;
}

/* One line too long for the quote on its own: cut at its last sentence end, else at a word. */
function cutLine(line: string, max: number): string {
  const head = line.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > max / 2) return marked(head.slice(0, sentence + 1));
  const space = head.lastIndexOf(" ");
  return marked(trimEnd(space > 0 ? head.slice(0, space) : head, CUT));
}

/* Keep whole lines: a quote that stops mid-thought reads as the writer trailing off. */
function cutLines(kept: readonly string[], max: number): string {
  const whole: string[] = [];
  let used = 0;
  for (const line of kept) {
    const next = used === 0 ? line.length : used + 1 + line.length;
    if (next > max) break;
    whole.push(line);
    used = next;
  }
  if (whole.length === 0) return cutLine(kept[0] ?? "", max);
  const text = whole.join("\n");
  return whole.length === kept.length ? text : marked(trimEnd(text, TRAILING));
}

const joined = (block: readonly string[]): string => block.join("\n");

/* A paragraph the quote stopped part-way through reads as cut mid-thought, so the quote
   stops on a paragraph boundary wherever one fits, and a lead-in to what was dropped goes
   with it. */
function wholeParagraphs(
  blocks: readonly (readonly string[])[],
  max: number,
): string | undefined {
  const kept: (readonly string[])[] = [];
  let used = 0;
  for (const block of blocks) {
    const size = joined(block).length;
    const next = used === 0 ? size : used + 1 + size;
    if (next > max) break;
    kept.push(block);
    used = next;
  }
  if (kept.length === 0) return undefined;
  if (kept.length === blocks.length) return kept.map(joined).join("\n");
  const tail = trimEnd(joined(kept[kept.length - 1] ?? []), TRAILING);
  const leadIn = !ENDS_SENTENCE.test(tail) && kept.length > 1;
  const body = (leadIn ? kept.slice(0, -1) : kept).map(joined).join("\n");
  return marked(trimEnd(body, TRAILING));
}

function shorten(blocks: readonly (readonly string[])[], max: number): string {
  return wholeParagraphs(blocks, max) ?? cutLines(blocks[0] ?? [], max);
}

/** The reason as a card may quote it, or `undefined` when there is nothing to quote. */
export function plainQuote(reason: string | undefined, max: number): string | undefined {
  if (reason === undefined) return undefined;
  const blocks = paragraphs(reason);
  if (blocks.length === 0) return undefined;
  const shortened = shorten(blocks, max);
  const quoted = shortened.endsWith(ELLIPSIS) ? shortened : trimEnd(shortened, TRAILING);
  return quoted === "" ? undefined : quoted;
}
