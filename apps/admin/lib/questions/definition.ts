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

// Mint option ids only when adding content; relabel and reorder must preserve identity because rules address ids.

export const DEFAULT_LOCALE = "en";

export const PATTERN_INPUT_LIMIT = 256;

// Trim by indices to avoid a trailing anchored quantifier backtracking on every slug keystroke.
function identifierCore(text: string): string {
  const collapsed = text.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "_") start += 1;
  while (end > start && collapsed[end - 1] === "_") end -= 1;
  return collapsed.slice(start, end);
}

export function questionIdFromSlug(slug: string): string {
  const core = identifierCore(slug);
  return core === "" ? "" : `q_${core}`;
}

// Resolve duplicate labels while minting: the kernel refuses duplicate option ids rather than inventing a suffix.
export function mintOptionId(label: string, taken: readonly string[]): string {
  const core = identifierCore(label);
  const base = `opt_${core === "" ? "option" : core}`;
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function textOf(text: LocalizedText | undefined, locale = DEFAULT_LOCALE): string {
  if (text === undefined) return "";
  return text[locale] ?? Object.values(text)[0] ?? "";
}

// Blank optional text must be absent; an empty localized value is rejected by the kernel.
export function localized(text: string, locale = DEFAULT_LOCALE): LocalizedText | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : { [locale]: trimmed };
}

// Preserve whitespace while typing: trimming controlled state makes trailing spaces unwritable.
// Normalise once at forWire; only an empty string is absent during editing.
export function localizedDraft(text: string, locale = DEFAULT_LOCALE): LocalizedText | undefined {
  return text === "" ? undefined : { [locale]: text };
}

function trimLocalized(text: LocalizedText | undefined): LocalizedText | undefined {
  if (text === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(text)) {
    const trimmed = value.trim();
    if (trimmed !== "") out[locale] = trimmed;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function hasOptions(type: QuestionType): boolean {
  return type === "singleChoice" || type === "multiChoice";
}

// Share constraint ownership between inline error fields and wire pruning so one cannot silently drift.
// Boolean and singleChoice accept no constraints object, including an empty one.
export const CONSTRAINT_FIELDS: Readonly<Record<QuestionType, readonly string[]>> = {
  shortText: ["minLength", "maxLength", "pattern"],
  longText: ["maxLength"],
  number: ["min", "max", "integer"],
  date: ["min", "max"],
  boolean: [],
  singleChoice: [],
  multiChoice: ["minSelected", "maxSelected"],
};

// Mirror authoredMessageKeys without importing kernel values into the BFF.
// Offer messages only for constraints carrying values; clearing a constraint also removes its override.
export function authoredMessageKeys(
  definition: QuestionDefinitionView,
): readonly ValidationMessageKey[] {
  const active = pruneConstraints(definition.constraints ?? {}, CONSTRAINT_FIELDS[definition.type]);
  return VALIDATION_MESSAGE_KEYS.filter((key) => {
    if (key === "required") return definition.required === true;
    const value = active[key];
    // false clears the integer constraint and must not retain a message key.
    return value !== undefined && value !== false;
  });
}

const MESSAGE_BOUND_PARAM: Readonly<Partial<Record<ValidationMessageKey, "n" | "bound">>> = {
  minLength: "n",
  maxLength: "n",
  min: "bound",
  max: "bound",
  minSelected: "n",
  maxSelected: "n",
};

function boundFor(
  constraints: ConstraintsView,
  key: ValidationMessageKey,
): string | number | undefined {
  const value = (constraints as Readonly<Record<string, unknown>>)[key];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

// Mirror respondent defaults so placeholders predict the shipped wording; keep the core and portal copies aligned.
export function defaultMessageFor(
  key: ValidationMessageKey,
  definition: QuestionDefinitionView,
): string {
  const param = MESSAGE_BOUND_PARAM[key];
  if (param === undefined) return t(`questions.message.default.${key}`);
  const bound = boundFor(definition.constraints ?? {}, key);
  // Leave missing interpolation tokens visible instead of silently inventing a bound.
  return bound === undefined
    ? t(`questions.message.default.${key}`)
    : t(`questions.message.default.${key}`, { [param]: bound });
}

export function messageLabelFor(
  key: ValidationMessageKey,
  definition: QuestionDefinitionView,
): string {
  if (definition.type === "date" && (key === "min" || key === "max")) {
    return t(`questions.message.label.date.${key}`);
  }
  return t(`questions.message.label.${key}`);
}

// Blank removes the key to inherit defaults. Preserve trailing spaces during typing, as localizedDraft requires.
export function withMessage(
  messages: ValidationMessagesView,
  key: ValidationMessageKey,
  text: string,
): ValidationMessagesView {
  const draft = localizedDraft(text);
  const next: Record<string, LocalizedText> = {};

  for (const existing of VALIDATION_MESSAGE_KEYS) {
    const value = existing === key ? draft : messages[existing];
    if (value !== undefined) next[existing] = value;
  }
  return next;
}

// Start choice types without options: ids minted from blank labels would be permanently meaningless.
export function blankDefinition(type: QuestionType, questionId: string): QuestionDefinitionView {
  const base = { questionId, type, label: {}, required: false, constraints: {} } as const;
  return hasOptions(type) ? { ...base, options: [] } : base;
}

export function relabelOption(
  options: readonly ChoiceOptionView[],
  index: number,
  label: string,
): readonly ChoiceOptionView[] {
  return options.map((option, at) =>
    at === index ? { optionId: option.optionId, label: localizedDraft(label) ?? {} } : option,
  );
}

// Swap whole records so a label cannot acquire a different permanent option id.
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

export function removeOption(
  options: readonly ChoiceOptionView[],
  index: number,
): readonly ChoiceOptionView[] {
  return options.filter((_option, at) => at !== index);
}

// Prune type-inapplicable fields and blank optional text before transport; the API remains the validator.
export function forWire(definition: QuestionDefinitionView): QuestionDefinitionView {
  const { type, constraints, options, help, label, messages, yesLabel, noLabel, ...rest } =
    definition;
  const wire: Record<string, unknown> = { ...rest, type };

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

// Keep only messages backed by current constraints, in canonical order for content-stable serialization.
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

// Cleared constraints must be absent, not present with empty values that the kernel would reject.
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
