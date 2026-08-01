import type {
  ChoiceOptionView,
  ConstraintsView,
  LocalizedText,
  QuestionDefinitionView,
  QuestionType,
} from "./types.ts";

/**
 * Identifier minting and definition scaffolding for the question editor (task 032).
 *
 * ## Why the admin mints ids at all, when it validates nothing
 *
 * `questionId` and `optionId` are **authored**, not allocated: the API never invents
 * one, because R6 makes an id a permanent, human-meaningful name rather than a serial
 * number ("q_at_fault_accident" is what a rule reads three years from now). So the
 * screen where a human names the thing is the screen that proposes the id, and the API
 * remains the only thing that decides whether the proposal is legal - it rejects a
 * malformed id with `INVALID_QUESTION_DEFINITION` and a reused one with
 * `QUESTION_ID_REUSED`, and this module never pretends to know either answer.
 *
 * ## The one invariant this module exists to protect
 *
 * An `optionId` is minted **once**, at the moment the option is added, from the label
 * it was added with. After that it is frozen: relabelling an option changes what a
 * respondent reads, and reordering changes where it sits, and neither may change what a
 * rule matches on. Every mutation helper below therefore carries `optionId` through
 * untouched, and the only function that produces one is `mintOptionId`, which is only
 * ever called from "add option".
 */

/** The single launch locale (R7: no second locale before Phase 4). */
export const DEFAULT_LOCALE = "en";

/** Longest pattern the kernel's RE2-safe subset accepts, used as an input cap only. */
export const PATTERN_INPUT_LIMIT = 256;

/**
 * Lower-case, underscore-separated core of an identifier.
 *
 * The trimming is done with indices rather than with `/^_+/` and `/_+$/`, and that is not
 * style: an anchored-at-the-end quantifier backtracks, which the lint gate rejects as
 * super-linear. This runs on every keystroke of the slug field, so it is exactly the place
 * that would matter.
 */
function identifierCore(text: string): string {
  const collapsed = text.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "_") start += 1;
  while (end > start && collapsed[end - 1] === "_") end -= 1;
  return collapsed.slice(start, end);
}

/**
 * The `q_`-prefixed id a slug proposes, or `""` when the slug carries no usable
 * characters at all. Shown live beside the slug field so an author sees the permanent
 * name before committing to it.
 */
export function questionIdFromSlug(slug: string): string {
  const core = identifierCore(slug);
  return core === "" ? "" : `q_${core}`;
}

/**
 * Mint an `opt_` id for a newly added option, unique within the question.
 *
 * Uniqueness is settled here rather than at save time because the kernel rejects a
 * duplicate outright (`DUPLICATE_OPTION_ID`) and an author adding "Other" twice should
 * get a working second row, not an error. The suffix counts from 2 so the common case
 * reads as the label (`opt_red`), not as a serial.
 */
export function mintOptionId(label: string, taken: readonly string[]): string {
  const core = identifierCore(label);
  const base = `opt_${core === "" ? "option" : core}`;
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** Read a localized text in the launch locale, falling back to any locale it carries. */
export function textOf(text: LocalizedText | undefined, locale = DEFAULT_LOCALE): string {
  if (text === undefined) return "";
  return text[locale] ?? Object.values(text)[0] ?? "";
}

/**
 * Build a `LocalizedText`, or `undefined` when the text is blank.
 *
 * The kernel's `LocalizedText` rejects an empty string value, so an optional field left
 * blank has to be *absent* rather than `{ en: "" }`. Getting this wrong is a
 * validation error on a field the author never touched.
 */
export function localized(text: string, locale = DEFAULT_LOCALE): LocalizedText | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : { [locale]: trimmed };
}

/**
 * The same thing, for a field the author is **actively typing into**.
 *
 * Whitespace is preserved exactly. `localized` trims, and in a fully controlled field
 * that makes a trailing space unwritable: the keystroke lands, the trim strips it, the
 * trimmed value flows back through state, and the caret ends up where it started - so
 * an author can add a space in the middle of a sentence but never at the end, and
 * cannot type a normal sentence at all (Code Owner, 2026-08-01).
 *
 * Only a genuinely empty string becomes `undefined`, because the kernel's
 * `LocalizedText` rejects an empty value and an untouched optional field has to be
 * absent rather than `{ en: "" }`. Whitespace-only text stays as typed here and is
 * normalized once, at {@link forWire}, which is the right boundary for it: what the
 * author sees while editing is exactly what they typed, and what is stored is tidy.
 */
export function localizedDraft(text: string, locale = DEFAULT_LOCALE): LocalizedText | undefined {
  return text === "" ? undefined : { [locale]: text };
}

/** Trim every locale of a text, dropping the field entirely when nothing survives. */
function trimLocalized(text: LocalizedText | undefined): LocalizedText | undefined {
  if (text === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(text)) {
    const trimmed = value.trim();
    if (trimmed !== "") out[locale] = trimmed;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** Types that carry an option list. */
export function hasOptions(type: QuestionType): boolean {
  return type === "singleChoice" || type === "multiChoice";
}

/**
 * The constraint fields each type owns (`DOMAIN_SCHEMA.md` §4.2).
 *
 * One list, read twice: the editor uses it to know which error paths it is able to show
 * inline, and `forWire` uses it to drop anything the type does not own. Two copies of
 * this knowledge would drift the moment a type gains a constraint, and the failure would
 * be silent (an error rendered nowhere, or a stray key rejected by the kernel).
 *
 * `boolean` and `singleChoice` have no `constraints` object at all in the kernel schema,
 * which is why their entry is empty rather than absent: an empty `constraints: {}` is
 * also rejected there.
 */
export const CONSTRAINT_FIELDS: Readonly<Record<QuestionType, readonly string[]>> = {
  shortText: ["minLength", "maxLength", "pattern"],
  longText: ["maxLength"],
  number: ["min", "max", "integer"],
  date: ["min", "max"],
  boolean: [],
  singleChoice: [],
  multiChoice: ["minSelected", "maxSelected"],
};

/**
 * A blank definition of the chosen type, as the creation screen starts from.
 *
 * A choice type starts with **no options at all**, which looks unhelpful and is the only
 * defensible answer. Pre-seeding two blank rows was tried first and is worse in both
 * directions: their ids would be minted from an empty label (`opt_option`, `opt_option_2`)
 * and then frozen, so an author who typed "Red" into the first row would be left with a
 * permanent id that says nothing about it, forever (R6 - the id cannot be corrected
 * later). And a blank label is not a legal option anyway, so the pre-seeded rows made the
 * first save fail with two `OPTION_LABEL_EMPTY` issues on rows the author had not created.
 *
 * Adding an option through the add field mints its id from the label it was named with,
 * which is the whole point of minting once.
 */
export function blankDefinition(type: QuestionType, questionId: string): QuestionDefinitionView {
  const base = { questionId, type, label: {}, required: false, constraints: {} } as const;
  return hasOptions(type) ? { ...base, options: [] } : base;
}

/** Replace one option's label, leaving its `optionId` exactly as minted (R6). */
export function relabelOption(
  options: readonly ChoiceOptionView[],
  index: number,
  label: string,
): readonly ChoiceOptionView[] {
  return options.map((option, at) =>
    at === index ? { optionId: option.optionId, label: localizedDraft(label) ?? {} } : option,
  );
}

/**
 * Move one option up (`-1`) or down (`+1`), carrying its id with it.
 *
 * Reorder is a swap of whole option records rather than of labels, which is the shape
 * that makes id stability structural instead of remembered: there is no expression here
 * that could assign an id to a different label.
 */
export function moveOption(
  options: readonly ChoiceOptionView[],
  index: number,
  delta: -1 | 1,
): readonly ChoiceOptionView[] {
  const target = index + delta;
  if (index < 0 || index >= options.length || target < 0 || target >= options.length) {
    return options;
  }
  const next = [...options];
  const moved = next[index];
  const displaced = next[target];
  if (moved === undefined || displaced === undefined) return options;
  next[index] = displaced;
  next[target] = moved;
  return next;
}

/** Append an option with a freshly minted, permanent id. */
export function addOption(
  options: readonly ChoiceOptionView[],
  label: string,
): readonly ChoiceOptionView[] {
  const optionId = mintOptionId(
    label,
    options.map((option) => option.optionId),
  );
  return [...options, { optionId, label: localizedDraft(label) ?? {} }];
}

/** Remove one option. Nothing is renumbered: the survivors keep their ids. */
export function removeOption(
  options: readonly ChoiceOptionView[],
  index: number,
): readonly ChoiceOptionView[] {
  return options.filter((_option, at) => at !== index);
}

/**
 * Strip the keys the kernel would reject for this type before sending.
 *
 * `boolean` and `singleChoice` have no `constraints` object at all in the kernel's
 * schema, and a non-choice type has no `options`; sending either is an
 * `INVALID_QUESTION_DEFINITION` on a field the editor never showed. Blank optional text
 * is dropped for the same reason (see `localized`). This is marshalling, not validation:
 * it removes what the editor could not have meant, and decides nothing about what is
 * legal.
 */
export function forWire(definition: QuestionDefinitionView): QuestionDefinitionView {
  const { type, constraints, options, help, label, ...rest } = definition;
  const wire: Record<string, unknown> = { ...rest, type };
  // Trim here rather than on every keystroke: this is the one boundary where the text
  // stops being something the author is still typing. See `localizedDraft`.
  wire["label"] = trimLocalized(label) ?? {};
  const trimmedHelp = trimLocalized(help);
  if (trimmedHelp !== undefined) wire["help"] = trimmedHelp;
  if (hasOptions(type)) {
    wire["options"] = (options ?? []).map((option) => ({
      optionId: option.optionId,
      label: trimLocalized(option.label) ?? {},
    }));
  }
  const owned = CONSTRAINT_FIELDS[type];
  if (owned.length > 0) wire["constraints"] = pruneConstraints(constraints ?? {}, owned);
  return wire as unknown as QuestionDefinitionView;
}

/**
 * Keep the constraints this type owns and that carry a value.
 *
 * Both halves matter. A key from another type is a schema error on a field the editor
 * never showed (a leftover `pattern` after switching a draft's type would be one), and a
 * key whose value is `undefined` or `""` is a field the author cleared, which has to be
 * absent rather than present-and-empty for the kernel to read it as "no constraint".
 */
function pruneConstraints(
  constraints: ConstraintsView,
  owned: readonly string[],
): Record<string, unknown> {
  const indexed = constraints as Readonly<Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  for (const key of owned) {
    const value = indexed[key];
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}
