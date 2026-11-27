// @ts-check
/**
 * The text rules the assistant review and the agent builder eval both apply to a reply: the
 * words and identifiers it may not carry, the openings it may not use, and the acts it may
 * not claim for itself. One module, so the two layers cannot drift apart.
 */

export {
  FORBIDDEN_TERMS,
  ID_PATTERN,
  ID_PREFIXES,
  PROMPT_AVOID_WORDS,
  PROMPT_SOURCE,
  REVIEW_ONLY_TERMS,
  findForbiddenTerms,
  findIdentifiers,
  termPattern,
} from "./agent-review/terms.mjs";

/** Verbs the assistant may never claim for itself: it proposes, and the person confirms. */
const SELF_CLAIM =
  /\bI(?:['’]ve| have)?\s+(?:just\s+)?(?:created|added|published|released|made|minted|built|deleted|removed|set up|saved)\b/giu;

/** A reply that opens with one of these has buried its answer behind filler. */
const FILLER_OPENINGS = [
  "sure",
  "of course",
  "certainly",
  "absolutely",
  "great question",
  "good question",
  "happy to",
  "i'd be happy to",
  "i’d be happy to",
  "thanks for",
  "no problem",
  "as requested",
];

/**
 * An opener naming the look-up a turn has to make before it can answer. The prompt allows
 * exactly one short clause of it, so this matches the shape and {@link lookUpOpenerFault}
 * judges the length.
 */
const LOOK_UP_OPENING =
  /^(?:first,?\s+)?(?:(?:i['’]?(?:m|ll)|i\s+(?:am|will)|let\s+me|just)\s+)?(?:going\s+to\s+|about\s+to\s+|start\s+by\s+)?(?:check|read|look|search|find|confirm|see|pull)\w*\b/iu;

/** Words that hang a second clause off the opener, which turns it into a narrated plan. */
const SECOND_CLAUSE =
  /\b(?:before|after|once|while|because|since|so\s+(?:that|i|we|you|it)|then|and\s+(?:then|i|we)|to\s+(?:see|check|find|confirm|work\s+out|make\s+sure|get)|which|that\s+way)\b/iu;

/** Longer than one short clause naming a look-up needs to be. */
const LOOK_UP_OPENER_WORDS = 12;

/**
 * @param {string} text
 * @returns {string}
 */
export function firstSentence(text) {
  const trimmed = text.trim();
  const end = /[.!?](?:\s|$)/u.exec(trimmed);
  return end === null ? trimmed : trimmed.slice(0, end.index + 1);
}

/**
 * A transcript recorded before the harness stopped copying the panel's speaker heading into
 * the reply opens with that heading, and the opening sentence is then the label rather than
 * the reply. Localised, so the shape is what identifies it: a short first line, no sentence
 * punctuation, prose under it.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripSpeakerLabel(text) {
  const trimmed = text.trim();
  const [head = "", ...rest] = trimmed.split("\n");
  const label = head.trim();
  const body = rest.join("\n").trim();
  const isLabel =
    body !== "" && label.length <= 24 && label.split(/\s+/u).length <= 3 && !/[.!?:]$/u.test(label);
  return isLabel ? body : trimmed;
}

/**
 * Why a look-up opener is more than the one short clause the prompt allows, or `null` when
 * it is within it.
 *
 * @param {string} opener
 * @param {string} rest
 * @returns {string | null}
 */
function lookUpOpenerFault(opener, rest) {
  if (rest === "") return "the reply announces a look-up and never gives the answer";
  if (SECOND_CLAUSE.test(opener)) {
    return "the look-up opener narrates the plan instead of naming the look-up in one clause";
  }
  const words = opener.split(/\s+/u).filter((word) => word !== "").length;
  return words > LOOK_UP_OPENER_WORDS
    ? `the look-up opener runs to ${String(words)} words where one short clause is allowed`
    : null;
}

/**
 * Why the reply's opening sentence buries the answer, or `null` when it does not. Takes the
 * reply with any speaker label already stripped.
 *
 * @param {string} spoken
 * @returns {string | null}
 */
export function openingFault(spoken) {
  const opener = firstSentence(spoken);
  const opening = opener.toLowerCase();
  if (FILLER_OPENINGS.some((filler) => opening.startsWith(filler))) {
    return "the reply opens with filler instead of the result";
  }
  if (!LOOK_UP_OPENING.test(opening)) return null;
  return lookUpOpenerFault(opener, spoken.slice(opener.length).trim());
}

/**
 * Every act the reply claims as its own, in the order they appear.
 *
 * @param {string} text
 * @returns {{ match: string; index: number }[]}
 */
export function selfClaims(text) {
  return [...text.matchAll(SELF_CLAIM)].map((found) => ({
    match: found[0],
    index: found.index ?? 0,
  }));
}
