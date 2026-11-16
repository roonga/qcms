import { QUESTION_TYPES, SEMANTICS_VERSION, VALIDATION_MESSAGE_KEYS } from "@roonga/qcms-core";

import { SYSTEM_PROMPT_SECTIONS } from "./prompts/prompts.generated.js";

/** Bump on every change to the prompt text; it is logged with each turn, never inferred. */
export const SYSTEM_PROMPT_VERSION = 23;

/** The sha256 `pnpm check:prompts` holds the Markdown sources to at this version. */
export const PROMPT_SOURCE_HASH =
  "495dd452460dba98205a2760ab958cfa052810b16c2fb8e2f106a5fe2cdd35f5";

/** Written out because the `Condition` union exports no name list; the test keeps it in step. */
export const CONDITION_OPERATORS = [
  "equals",
  "notEquals",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "answered",
  "contains",
  "containsAny",
  "and",
  "or",
  "not",
  "anyInstance",
  "everyInstance",
  "instanceCount",
] as const;

/**
 * Words the assistant may never write to the person. The guidance half of the prompt is
 * held to the same list, so the model reads an example of the voice it is asked for.
 */
export const AVOID_WORDS = [
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
] as const;

/** The one line in the guidance that may carry the words themselves. */
export const AVOID_WORDS_LINE_PREFIX = "- Never write these words to the person:";

/** Where guidance ends and the kernel contracts the model speaks in tool calls begin. */
export const CONTRACTS_HEADING = "Domain contracts you must respect.";

const ANSWER_ENCODINGS: readonly (readonly [string, string])[] = [
  ["shortText / longText", "NFC-normalized string"],
  ["number", "finite IEEE double; `integer` is a validation constraint, not an encoding"],
  ["date", "timezone-less ISO `YYYY-MM-DD`, a real calendar date; ordering is lexicographic"],
  ["boolean", "JSON boolean"],
  ["singleChoice", "a single `OptionId`"],
  ["multiChoice", "`OptionId[]`, deduplicated, order-preserving; comparison is set equality"],
];

function encodingTable(): string {
  return ANSWER_ENCODINGS.map(([type, encoding]) => `- ${type}: ${encoding}`).join("\n");
}

/** What each `{{NAME}}` in the Markdown sources stands for, computed from the kernel. */
const PLACEHOLDER_VALUES: Readonly<Record<string, () => string>> = {
  AVOID_WORDS: () => AVOID_WORDS.join(", "),
  QUESTION_TYPES: () => QUESTION_TYPES.map((type) => `- ${type}`).join("\n"),
  ANSWER_ENCODINGS: encodingTable,
  VALIDATION_MESSAGE_KEYS: () => VALIDATION_MESSAGE_KEYS.join(", "),
  SEMANTICS_VERSION: () => String(SEMANTICS_VERSION),
  CONDITION_OPERATORS: () => CONDITION_OPERATORS.join(", "),
};

const PLACEHOLDER = /\{\{(\w*)\}\}/g;

/** Must stay deterministic: identical bytes are what make upstream prompt caching work. */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT_SECTIONS.join("\n\n").replaceAll(PLACEHOLDER, (_whole, name: string) => {
    const value = PLACEHOLDER_VALUES[name];
    if (value === undefined) {
      throw new Error(`The prompt sources use {{${name}}}, which nothing fills.`);
    }
    return value();
  });
}
