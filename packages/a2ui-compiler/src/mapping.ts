import { VALIDATION_MESSAGE_KEYS } from "@roonga/qcms-core";
import type { LocaleCode, LocalizedText, QuestionDefinition } from "@roonga/qcms-core";

import type { A2UINode } from "./types.js";

/**
 * Question-type to A2UI component mapping (`docs/a2ui-mapping.md`).
 *
 * A constraint-derived prop is an advisory client-side hint; server-side domain
 * validation is the authority.
 *
 * No control sets `errorMessage`: that is the per-question error slot the
 * renderer fills from server validation, routed by `name`. A control may carry
 * `messages` (ADR-32), which is presentation payload for that slot and never
 * something the renderer or the kernel evaluates.
 */

/** Resolves a {@link LocalizedText} to a display string for the active locale. */
export type TextResolver = (text: LocalizedText) => string;

/**
 * Above this option count a `singleChoice` compiles to a `Select` rather than a
 * `RadioGroup`. A compiler constant, frozen into output by `compilerVersion`.
 */
export const SINGLE_CHOICE_SELECT_THRESHOLD = 7;

/** The wire values a boolean question's two radios carry. */
export const BOOLEAN_TRUE_VALUE = "true";
export const BOOLEAN_FALSE_VALUE = "false";

/**
 * The boolean child-label lexicon, keyed by the active locale's language subtag
 * with an English fallback. A compiler constant frozen into output.
 *
 * It is the default rather than the only source: a question may carry authored
 * labels (ADR-36), and each falls back here on its own, so overriding one leaves
 * the other on the lexicon. The wire values are untouched either way.
 */
type Affirmation = { readonly yes: string; readonly no: string };

export const BOOLEAN_AFFIRMATION: { readonly en: Affirmation } & Readonly<
  Record<string, Affirmation>
> = {
  en: { yes: "Yes", no: "No" },
};

function affirmationFor(locale: LocaleCode): Affirmation {
  const language = locale.split("-")[0] ?? "";
  // `.en` is a guaranteed key, so the fallback is total.
  return BOOLEAN_AFFIRMATION[language] ?? BOOLEAN_AFFIRMATION.en;
}

/** Insertion order is preserved, because the output is byte-compared. */
function compact(props: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The author-supplied validation messages for one question, resolved for the
 * active locale (ADR-32). `undefined` when the author supplied none, so the
 * prop is dropped and such a question compiles byte-for-byte as before.
 *
 * Keys are emitted in the kernel's canonical order rather than the authored
 * object's, so the compiled document is a function of content alone (ADR-18).
 */
function authorMessages(
  question: QuestionDefinition,
  resolve: TextResolver,
): Readonly<Record<string, string>> | undefined {
  const { messages } = question;
  if (messages === undefined) return undefined;
  const resolved: Record<string, string> = {};
  for (const key of VALIDATION_MESSAGE_KEYS) {
    const text = messages[key];
    if (text !== undefined) {
      resolved[key] = resolve(text);
    }
  }
  return Object.keys(resolved).length === 0 ? undefined : resolved;
}

/** Props shared by every top-level control. */
function baseControlProps(
  question: QuestionDefinition,
  resolve: TextResolver,
): Record<string, unknown> {
  return {
    label: resolve(question.label),
    description: question.help === undefined ? undefined : resolve(question.help),
    name: question.questionId,
    isRequired: question.required ? true : undefined,
    messages: authorMessages(question, resolve),
  };
}

function radioChild(value: string, label: string): A2UINode {
  return { type: "Radio", props: { value, label } };
}

function checkboxChild(value: string, label: string): A2UINode {
  return { type: "Checkbox", props: { value, label } };
}

/**
 * Compile one pinned question to its A2UI control node. The switch is
 * exhaustive with a `never` default, so adding a question type without mapping
 * it is a build error.
 */
export function questionToNode(
  question: QuestionDefinition,
  resolve: TextResolver,
  locale: LocaleCode,
): A2UINode {
  const base = baseControlProps(question, resolve);
  switch (question.type) {
    case "shortText":
      return {
        type: "TextField",
        props: compact({
          ...base,
          minLength: question.constraints.minLength,
          maxLength: question.constraints.maxLength,
          pattern: question.constraints.pattern,
        }),
      };
    case "longText":
      return {
        type: "TextArea",
        props: compact({ ...base, maxLength: question.constraints.maxLength }),
      };
    case "number":
      return {
        type: "NumberField",
        props: compact({
          ...base,
          minValue: question.constraints.min,
          maxValue: question.constraints.max,
          step: question.constraints.integer ? 1 : undefined,
        }),
      };
    case "date":
      return {
        type: "DatePicker",
        props: compact({
          ...base,
          granularity: "day",
          minValue: question.constraints.min,
          maxValue: question.constraints.max,
        }),
      };
    case "boolean": {
      // Each label falls back on its own (ADR-36), and the wire values never
      // move.
      const lexicon = affirmationFor(locale);
      const yes = question.yesLabel === undefined ? lexicon.yes : resolve(question.yesLabel);
      const no = question.noLabel === undefined ? lexicon.no : resolve(question.noLabel);
      return {
        type: "RadioGroup",
        props: compact(base),
        children: [radioChild(BOOLEAN_TRUE_VALUE, yes), radioChild(BOOLEAN_FALSE_VALUE, no)],
      };
    }
    case "singleChoice":
      if (question.options.length > SINGLE_CHOICE_SELECT_THRESHOLD) {
        return {
          type: "Select",
          props: compact({
            ...base,
            items: question.options.map((option) => ({
              label: resolve(option.label),
              value: option.optionId,
            })),
          }),
        };
      }
      return {
        type: "RadioGroup",
        props: compact(base),
        children: question.options.map((option) =>
          radioChild(option.optionId, resolve(option.label)),
        ),
      };
    case "multiChoice":
      return {
        type: "CheckboxGroup",
        props: compact({ ...base, orientation: "vertical" }),
        children: question.options.map((option) =>
          checkboxChild(option.optionId, resolve(option.label)),
        ),
      };
    /* v8 ignore next 2 -- unreachable by construction (exhaustive union) */
    default:
      return assertNeverQuestion(question);
  }
}

/* v8 ignore next 3 -- compile-time never-exhaustiveness guard; unreachable */
function assertNeverQuestion(question: never): never {
  throw new Error(`Unhandled question type: ${String((question as { type?: unknown }).type)}`);
}
