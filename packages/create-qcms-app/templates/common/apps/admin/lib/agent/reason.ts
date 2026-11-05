/* The card's quoted reason is model prose, so it is shown as plain text and never rendered as markup
   (SEC-17 §8d). Flatten the syntax a model writes anyway, and cut on a word boundary. */

export const REASON_CHARS = 280;

const ELLIPSIS = "…";

/* Inline constructs the assistant's own markdown subset allows, reduced to their text. */
function flatten(text: string): string {
  return text
    .replaceAll(/`+/g, "")
    .replaceAll(/!\[/g, "[")
    .replaceAll(/\[([^\][]*)\]\(([^()]*)\)/g, "$1")
    .replaceAll(/(\*\*|__)([^*_]*)\1/g, "$2")
    .replaceAll(/([*_])([^*_]*)\1/g, "$2")
    .replaceAll(/^ {0,3}#{1,6} +/gm, "")
    .replaceAll(/^ {0,3}> ?/gm, "")
    .replaceAll(/^ {0,3}([-*+]|\d{1,3}[.)]) +/gm, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/* Cut at the last sentence end, else the last space, so a quote never breaks mid-word. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > max / 2) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[,;:]$/, "")}${ELLIPSIS}`;
}

/** The reason as a card may quote it, or `undefined` when there is nothing to quote. */
export function plainQuote(reason: string | undefined, max: number): string | undefined {
  if (reason === undefined) return undefined;
  const flat = flatten(reason);
  return flat === "" ? undefined : shorten(flat, max);
}
