import type { LocaleCode, LocalizedText, QuestionDefinition } from "@qcms/core";

import type { A2UINode } from "./types.js";

/**
 * Question-type → A2UI component mapping (task 011, `docs/a2ui-mapping.md`).
 *
 * Every function here is a pure projection from one pinned {@link
 * QuestionDefinition} to a single A2UI control node whose `type` is a real
 * `@a2ra/core` node literal and whose props are a subset of that component's
 * strict schema. Constraint-derived props are **advisory client-side hints**;
 * server-side domain validation (`validateAnswer`, task 009) is the authority.
 *
 * Accessibility groundwork (028 contract): every control carries `label`, a
 * `description` when the question has help text, and a `name` = questionId. No
 * control sets `errorMessage` — that is the per-question error slot the renderer
 * fills from server validation, routed by `name`.
 */

/** Resolves a {@link LocalizedText} to a display string for the active locale. */
export type TextResolver = (text: LocalizedText) => string;

/**
 * Above this option count a `singleChoice` renders as a `Select` rather than a
 * `RadioGroup` (`docs/a2ui-mapping.md`). A compiler constant, frozen into
 * output via `compilerVersion`.
 */
export const SINGLE_CHOICE_SELECT_THRESHOLD = 7;

/** The A2UI values a boolean question's two radios carry. */
export const BOOLEAN_TRUE_VALUE = "true";
export const BOOLEAN_FALSE_VALUE = "false";

/**
 * Yes/No child-label lexicon for boolean radios, keyed by the active locale's
 * language subtag with an English fallback (`docs/a2ui-mapping.md`). A compiler
 * constant frozen into output; gains entries alongside each new launch locale
 * (R7 — no second locale before Phase 4).
 */
type Affirmation = { readonly yes: string; readonly no: string };

export const BOOLEAN_AFFIRMATION: { readonly en: Affirmation } & Readonly<
  Record<string, Affirmation>
> = {
  en: { yes: "Yes", no: "No" },
};

function affirmationFor(locale: LocaleCode): Affirmation {
  const language = locale.split("-")[0] ?? "";
  // `.en` is a guaranteed key (typed above), so the fallback is total.
  return BOOLEAN_AFFIRMATION[language] ?? BOOLEAN_AFFIRMATION.en;
}

/** Drop keys whose value is `undefined`, preserving insertion order (determinism). */
function compact(props: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Props shared by every top-level control: label, optional help, name, required hint. */
function baseControlProps(
  question: QuestionDefinition,
  resolve: TextResolver,
): Record<string, unknown> {
  return {
    label: resolve(question.label),
    description: question.help === undefined ? undefined : resolve(question.help),
    name: question.questionId,
    isRequired: question.required ? true : undefined,
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
 * exhaustive over the seven-type union with a `never` default — adding a
 * question type without mapping it here is a build error, not a runtime
 * surprise.
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
      const { yes, no } = affirmationFor(locale);
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
