/**
 * The plan's own outcome line. It is the one piece of model prose a card heading carries,
 * so it is flattened to a single plain line here and refused outright where it names an id
 * or a word the person may not be written to in (SEC-17 section 8d): every other word on a
 * card comes from the catalogue, and this one has to read like it did.
 */

import { AVOID_WORDS } from "../system-prompt.js";

/** A heading, not a sentence. Long enough for "Ask about allergies, then publish to test". */
export const MAX_PLAN_TITLE = 80;

/** The branded id prefixes in `packages/core/src/ids.ts`, plus the ids a card may name. */
const ID_PREFIXES = ["q", "frm", "stp", "opt", "rul", "ses", "lnk", "grp", "ins", "whk", "dlv"];

const BRANDED_ID = new RegExp(`\\b(?:${ID_PREFIXES.join("|")})_[a-z0-9_]+`, "iu");

/** A term carrying `_` is an id prefix and matches anywhere; anything else whole words only. */
function termPattern(term: string): RegExp {
  const body = term.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return term.includes("_") ? new RegExp(body, "iu") : new RegExp(`\\b${body}\\b`, "iu");
}

/**
 * The inline markdown the assistant's own subset allows, reduced to its text. An underscore
 * survives it: a branded id is the common case here, and stripping one would hide the id
 * from the check below.
 */
function flatten(raw: string): string {
  return raw
    .replaceAll(/[`*#>[\]]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export type PlanTitleOutcome =
  | { readonly title: string | undefined }
  | { readonly reason: string };

/** The title a card may show, or the reason the plan is refused rather than shown with it. */
export function readPlanTitle(raw: unknown): PlanTitleOutcome {
  if (raw === undefined) return { title: undefined };
  if (typeof raw !== "string") return { reason: "The plan's title must be a short line of text." };
  const title = flatten(raw);
  if (title === "") return { title: undefined };
  if (title.length > MAX_PLAN_TITLE) {
    return {
      reason:
        `The plan's title is ${String(title.length)} characters and may be at most ` +
        `${String(MAX_PLAN_TITLE)}. Say the outcome in a few plain words.`,
    };
  }
  const id = BRANDED_ID.exec(title)?.[0];
  if (id !== undefined) {
    return {
      reason: `The plan's title names ${id}. A title names the subject by its title, never by an id.`,
    };
  }
  for (const word of AVOID_WORDS) {
    if (termPattern(word).test(title)) {
      return {
        reason: `The plan's title uses "${word}", which you may never write to the person.`,
      };
    }
  }
  return { title };
}
