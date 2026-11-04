// Mirror wire shapes without importing kernel validators into the BFF; the API alone decides legality.

export const QUESTION_TYPES = [
  "shortText",
  "longText",
  "number",
  "date",
  "boolean",
  "singleChoice",
  "multiChoice",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export type QuestionStatus = "draft" | "published" | "deprecated";

export type LocalizedText = Readonly<Record<string, string>>;

// Option ids are permanent rule operands; relabel and reorder must never change them.
export interface ChoiceOptionView {
  readonly optionId: string;
  readonly label: LocalizedText;
}

// Explicit undefined represents a cleared controlled field under exactOptionalPropertyTypes.
// forWire removes that intermediate state before sending.
export interface ConstraintsView {
  readonly minLength?: number | undefined;

  readonly maxLength?: number | undefined;

  readonly pattern?: string | undefined;

  readonly min?: number | string | undefined;

  readonly max?: number | string | undefined;

  readonly integer?: boolean | undefined;

  readonly minSelected?: number | undefined;

  readonly maxSelected?: number | undefined;
}

// Mirror the kernel's canonical validation-message order for stable field order and serialization.
export const VALIDATION_MESSAGE_KEYS = [
  "required",
  "minLength",
  "maxLength",
  "pattern",
  "min",
  "max",
  "integer",
  "minSelected",
  "maxSelected",
] as const;

export type ValidationMessageKey = (typeof VALIDATION_MESSAGE_KEYS)[number];

// A cleared message is explicit undefined during editing and becomes absent on the wire to inherit the default.
export type ValidationMessagesView = Readonly<
  Partial<Record<ValidationMessageKey, LocalizedText | undefined>>
>;

export interface QuestionDefinitionView {
  readonly questionId: string;
  readonly type: QuestionType;
  readonly label: LocalizedText;
  readonly help?: LocalizedText | undefined;
  readonly required?: boolean | undefined;
  readonly options?: readonly ChoiceOptionView[] | undefined;
  readonly constraints?: ConstraintsView | undefined;
  // An absent message key inherits the shipped default.
  readonly messages?: ValidationMessagesView | undefined;
  // An absent affirmative override inherits the lexicon.
  readonly yesLabel?: LocalizedText | undefined;
  // An absent negative override inherits the lexicon.
  readonly noLabel?: LocalizedText | undefined;
}

export interface QuestionVersion {
  readonly questionId: string;
  readonly version: number;
  readonly status: QuestionStatus;
  readonly definition: QuestionDefinitionView;
  readonly publishedAt: string | null;
}

export interface QuestionListItem {
  readonly questionId: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly latestVersion: number;
  readonly latestStatus: QuestionStatus;
  readonly publishedAt: string | null;

  readonly label: LocalizedText | null;

  readonly type: QuestionType | null;
  // Absent versions means the response did not request them; an empty list means the question has none.
  // Only versions=all carries this field.
  readonly versions?: readonly QuestionVersion[];
}

export interface QuestionDetail {
  readonly questionId: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly versions: readonly QuestionVersion[];
}

export interface DefinitionIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

export interface PreviewDocument {
  readonly stepId: string;
  readonly root: unknown;
  readonly a2uiSpecVersion: string;
  readonly compilerVersion: string;
}
