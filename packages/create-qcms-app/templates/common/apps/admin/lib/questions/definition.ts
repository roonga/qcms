import { t } from "../i18n/en.ts";

import {
  VALIDATION_MESSAGE_KEYS,
  type ChoiceOptionView,
  type ConstraintsView,
  type LocalizedText,
  type QuestionDefinitionView,
  type QuestionType,
  type ValidationMessageKey,
  type ValidationMessagesView,
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
 * The constraint keys this question **carries**, and therefore the only keys it may hold
 * an author-supplied message for (task 048, ADR-32). In canonical
 * {@link VALIDATION_MESSAGE_KEYS} order.
 *
 * This restates `authoredMessageKeys` from `@qcms/core`, which the admin cannot import as
 * a value (R2, `lib/server/r2-import-surface.test.ts`) - exactly as `CONSTRAINT_FIELDS`
 * above restates the type-to-constraints map. The kernel remains the authority: it reports
 * `ORPHAN_MESSAGE_KEY` at publish for a message keyed by a constraint the question does not
 * carry. What this function buys is that the editor never *offers* such a field, so the
 * error is unreachable from the UI rather than merely caught.
 *
 * "Carries" is stricter than "the type could have": a `shortText` with no `minLength` set
 * can never produce a too-short error, so a message for it could never be shown. Two
 * consequences the editor depends on - unchecking "an answer is required" and clearing a
 * constraint each make that message field disappear, and `forWire` drops the message with
 * it.
 */
export function authoredMessageKeys(
  definition: QuestionDefinitionView,
): readonly ValidationMessageKey[] {
  // The same "did the author leave a value here?" test the wire marshalling uses, so a
  // field that prunes away cannot keep a message field on screen.
  const active = pruneConstraints(definition.constraints ?? {}, CONSTRAINT_FIELDS[definition.type]);
  return VALIDATION_MESSAGE_KEYS.filter((key) => {
    // `required` is a flow concern rather than a constraint, so it lives on the definition
    // and not in `constraints`. It is also the one key every type can carry.
    if (key === "required") return definition.required === true;
    const value = active[key];
    // `false` is the cleared state of the one boolean constraint (`integer`), and the
    // kernel reads it the same way: unticked carries no message key.
    return value !== undefined && value !== false;
  });
}

/**
 * Which bound the shipped default message interpolates, and under which name.
 *
 * A key absent from this map has a default with nothing to substitute (`pattern`,
 * `integer`, `required`). The bound itself is always read from the constraint of the same
 * name, which is why there is no second table saying where to find it.
 */
const MESSAGE_BOUND_PARAM: Readonly<Partial<Record<ValidationMessageKey, "n" | "bound">>> = {
  minLength: "n",
  maxLength: "n",
  min: "bound",
  max: "bound",
  minSelected: "n",
  maxSelected: "n",
};

/** One constraint's value, when it is a bound a message can name. */
function boundFor(
  constraints: ConstraintsView,
  key: ValidationMessageKey,
): string | number | undefined {
  const value = (constraints as Readonly<Record<string, unknown>>)[key];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

/**
 * The default message a respondent would see for one constraint of this question: what the
 * editor shows as the field's **placeholder**, with the question's own bound interpolated.
 *
 * The wording is a mirror of the kernel's and the portal's defaults rather than the admin's
 * own copy - see the note beside `questions.message.default.*` in `lib/i18n/en.ts` for why
 * that duplication exists and what has to move with it.
 */
export function defaultMessageFor(
  key: ValidationMessageKey,
  definition: QuestionDefinitionView,
): string {
  const param = MESSAGE_BOUND_PARAM[key];
  if (param === undefined) return t(`questions.message.default.${key}`);
  const bound = boundFor(definition.constraints ?? {}, key);
  // A missing bound is unreachable from the editor (the field is only rendered for a
  // constraint that carries a value), and leaving the `{n}` token visible is the honest
  // answer if it ever happens: `t` substitutes nothing it was not given.
  return bound === undefined
    ? t(`questions.message.default.${key}`)
    : t(`questions.message.default.${key}`, { [param]: bound });
}

/**
 * The label for one message field.
 *
 * `min` and `max` are shared by `number` and `date`, and a date's bounds are the same two
 * keys wearing different words ("too small" beside "Earliest date" makes an author
 * translate), so those two get their own wording.
 */
export function messageLabelFor(
  key: ValidationMessageKey,
  definition: QuestionDefinitionView,
): string {
  if (definition.type === "date" && (key === "min" || key === "max")) {
    return t(`questions.message.label.date.${key}`);
  }
  return t(`questions.message.label.${key}`);
}

/**
 * Set (or clear) one message, keeping the map in canonical key order.
 *
 * A blank field removes the key rather than storing an empty text, because an absent key IS
 * the inheritance (ADR-32) and the kernel rejects an empty `LocalizedText` value anyway.
 * `localizedDraft`, not `localized`, for the reason it documents: this runs on every
 * keystroke and a trim here would make a trailing space unwritable.
 */
export function withMessage(
  messages: ValidationMessagesView,
  key: ValidationMessageKey,
  text: string,
): ValidationMessagesView {
  const draft = localizedDraft(text);
  const next: Record<string, LocalizedText> = {};
  // Rebuilt in canonical order rather than spread-and-overwrite, so the key an author fills
  // in last does not end up last: `forWire` normalizes the order anyway, and a map that
  // already holds it makes the two impossible to disagree about.
  for (const existing of VALIDATION_MESSAGE_KEYS) {
    const value = existing === key ? draft : messages[existing];
    if (value !== undefined) next[existing] = value;
  }
  return next;
}

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
  const { type, constraints, options, help, label, messages, yesLabel, noLabel, ...rest } =
    definition;
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
  const authored = pruneMessages(definition, messages ?? {});
  if (Object.keys(authored).length > 0) wire["messages"] = authored;
  if (type === "boolean") {
    const yes = trimLocalized(yesLabel);
    if (yes !== undefined) wire["yesLabel"] = yes;
    const no = trimLocalized(noLabel);
    if (no !== undefined) wire["noLabel"] = no;
  }
  return wire as unknown as QuestionDefinitionView;
}

/**
 * Keep the messages this question can actually show, in canonical key order.
 *
 * Iterating {@link authoredMessageKeys} rather than the authored object's own keys does
 * three jobs at once: it drops an orphan (a message whose constraint was cleared, or which
 * belonged to the type a draft used to be), it drops a blank field so the absent key can
 * mean "inherit", and it fixes the serialization order so the same document produces the
 * same bytes whatever order the boxes were filled in.
 */
function pruneMessages(
  definition: QuestionDefinitionView,
  messages: ValidationMessagesView,
): Record<string, LocalizedText> {
  const out: Record<string, LocalizedText> = {};
  for (const key of authoredMessageKeys(definition)) {
    const trimmed = trimLocalized(messages[key]);
    if (trimmed !== undefined) out[key] = trimmed;
  }
  return out;
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
