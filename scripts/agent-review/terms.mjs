// @ts-check
/**
 * The one place the review harness states what the assistant may not say. The prompt's own
 * `AVOID_WORDS` is restated here rather than imported, because `apps/api` publishes `dist`
 * and cannot be reached from a tooling script; `terms.test.ts` fails on drift between them.
 */

/** Restates `AVOID_WORDS` in `apps/api/src/features/agent/system-prompt.ts`, word for word. */
export const PROMPT_AVOID_WORDS = [
  "frm_",
  "q_",
  "stp_",
  "rul_",
  "opt_",
  "grp_",
  "lnk_",
  "slug",
  "unpinned",
  "minted",
  "BFF",
  "draft v1",
  "halts",
  "operational",
];

/** Where the prompt's list lives, so the drift guard fails loudly when the file moves. */
export const PROMPT_SOURCE = "apps/api/src/features/agent/system-prompt.ts";

/**
 * Builder words a transcript can carry that the prompt's list does not name. Kept apart from
 * {@link PROMPT_AVOID_WORDS} so widening one cannot silently widen the other.
 */
export const REVIEW_ONLY_TERMS = [
  "API",
  "endpoint",
  "payload",
  "JSON",
  "schema",
  "parameter",
  "boolean",
  "enum",
  "database",
  "tool call",
  "backend",
  "handler",
  "identifier",
  "UUID",
  "serialize",
  "deserialize",
  "null",
  "undefined",
  "stack trace",
];

export const FORBIDDEN_TERMS = [...PROMPT_AVOID_WORDS, ...REVIEW_ONLY_TERMS];

/** The branded id prefixes in `packages/core/src/ids.ts`. */
export const ID_PREFIXES = ["q", "frm", "stp", "opt", "rul", "ses", "lnk", "grp", "ins"];

export const ID_PATTERN = new RegExp(`\\b(?:${ID_PREFIXES.join("|")})_[a-z0-9_]+\\b`, "giu");

/**
 * @param {string} term
 * @returns {string}
 */
function escape(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * A term carrying `_` is an id prefix and matches anywhere; anything else matches whole words
 * only, so `slug` does not fire on `sluggish`.
 *
 * @param {string} term
 * @returns {RegExp}
 */
export function termPattern(term) {
  const body = escape(term);
  return term.includes("_") ? new RegExp(body, "giu") : new RegExp(`\\b${body}\\b`, "giu");
}

/**
 * @param {string} text
 * @param {readonly string[]} [terms]
 * @returns {{ term: string; match: string; index: number }[]}
 */
export function findForbiddenTerms(text, terms = FORBIDDEN_TERMS) {
  /** @type {{ term: string; match: string; index: number }[]} */
  const hits = [];
  for (const term of terms) {
    for (const found of text.matchAll(termPattern(term))) {
      hits.push({ term, match: found[0], index: found.index ?? 0 });
    }
  }
  return hits.sort((left, right) => left.index - right.index);
}

/**
 * @param {string} text
 * @returns {{ match: string; index: number }[]}
 */
export function findIdentifiers(text) {
  return [...text.matchAll(ID_PATTERN)].map((found) => ({
    match: found[0],
    index: found.index ?? 0,
  }));
}
