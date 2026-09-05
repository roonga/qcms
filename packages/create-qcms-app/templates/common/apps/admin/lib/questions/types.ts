/**
 * The question library's **wire shapes** (task 032).
 *
 * These mirror the payloads the API's `/admin/questions` routes send and accept, and
 * they are deliberately hand-written rather than imported as values from `@roonga/qcms-core`.
 *
 * That is not duplication for its own sake, it is R2. The kernel's `QuestionDefinition`
 * is a Zod schema carrying branded ids, cross-field refinements and the validation
 * authority; importing it here would put a second validator in the BFF and let a screen
 * start deciding whether a definition is legal. The API is the only thing allowed to
 * answer that. What a BFF legitimately needs is a *view* of the bytes it carries, which
 * is what these types are: field names and primitive shapes, no rules, no brands, no
 * refinements, every constraint optional.
 *
 * The practical consequence, and it is intended: the admin cannot construct a definition
 * it knows to be valid. It sends what the operator typed and renders whatever the kernel
 * says back (`INVALID_QUESTION_DEFINITION` carries `path`-addressed issues, which is how
 * an error lands on the offending field).
 */

/** The seven question types (`DOMAIN_SCHEMA.md` §4.2). Order is the editor's picker order. */
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

/** A version's lifecycle state. There is no `deleted`: a question is deprecated (R6). */
export type QuestionStatus = "draft" | "published" | "deprecated";

/** locale code to text. Single locale at launch (R7), so in practice one `en` entry. */
export type LocalizedText = Readonly<Record<string, string>>;

/**
 * One choice option. `optionId` is minted once when the option is added and never
 * changes again, through every relabel and every reorder (R6: the rules engine
 * addresses answers by option id, so a shifted id silently rewrites history).
 */
export interface ChoiceOptionView {
  readonly optionId: string;
  readonly label: LocalizedText;
}

/**
 * Every constraint field any of the seven types can carry, all optional.
 *
 * Each is explicitly `| undefined` rather than merely optional, because the repo runs
 * with `exactOptionalPropertyTypes` and the editor genuinely needs the third state: a
 * field an author **cleared** is `{ maxLength: undefined }` while it is being edited, and
 * only becomes absent when `forWire` prunes it on the way out. Without the union the
 * editor could not express "the operator emptied this box".
 */
export interface ConstraintsView {
  /** shortText */
  readonly minLength?: number | undefined;
  /** shortText, longText */
  readonly maxLength?: number | undefined;
  /** shortText */
  readonly pattern?: string | undefined;
  /** number (numeric), date (canonical `YYYY-MM-DD` string) */
  readonly min?: number | string | undefined;
  /** number (numeric), date (canonical `YYYY-MM-DD` string) */
  readonly max?: number | string | undefined;
  /** number */
  readonly integer?: boolean | undefined;
  /** multiChoice */
  readonly minSelected?: number | undefined;
  /** multiChoice */
  readonly maxSelected?: number | undefined;
}

/**
 * The constraint keys an author may write a message for (task 048, ADR-32), in the
 * kernel's canonical order.
 *
 * Restated here rather than imported, for the same R2 reason as everything else in this
 * module: `@roonga/qcms-core` owns `ValidationMessageKey` and the admin may not import it as a
 * value (`lib/server/r2-import-surface.test.ts`). The order matters beyond tidiness - the
 * editor renders the fields in it, and `forWire` serializes in it, so a message map is a
 * function of content rather than of the order an author happened to fill the boxes in.
 *
 * Keep in step with `ValidationMessageKey` in `packages/core/src/validation-message.ts`.
 */
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

/**
 * Author-supplied validation messages, one optional text per constraint key.
 *
 * Explicitly `| undefined` for the same `exactOptionalPropertyTypes` reason as
 * {@link ConstraintsView}: a message field an author has **cleared** is
 * `{ minLength: undefined }` while it is being edited, and only becomes absent when
 * `forWire` prunes it. An absent key is what "inherit the default" is stored as, so
 * present-and-empty would be a message no respondent should ever see.
 */
export type ValidationMessagesView = Readonly<
  Partial<Record<ValidationMessageKey, LocalizedText | undefined>>
>;

/** A question definition as it travels over the wire. */
export interface QuestionDefinitionView {
  readonly questionId: string;
  readonly type: QuestionType;
  readonly label: LocalizedText;
  readonly help?: LocalizedText | undefined;
  readonly required?: boolean | undefined;
  readonly options?: readonly ChoiceOptionView[] | undefined;
  readonly constraints?: ConstraintsView | undefined;
  /** Per-constraint message overrides (task 048, ADR-32). Absent key = inherit. */
  readonly messages?: ValidationMessagesView | undefined;
  /** boolean only: the displayed affirmative label (task 048, ADR-36). Absent = lexicon. */
  readonly yesLabel?: LocalizedText | undefined;
  /** boolean only: the displayed negative label (task 048, ADR-36). Absent = lexicon. */
  readonly noLabel?: LocalizedText | undefined;
}

/** One version row of a question (`QuestionVersionView` on the API side). */
export interface QuestionVersion {
  readonly questionId: string;
  readonly version: number;
  readonly status: QuestionStatus;
  readonly definition: QuestionDefinitionView;
  readonly publishedAt: string | null;
}

/** One row of `GET /admin/questions`. */
export interface QuestionListItem {
  readonly questionId: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly latestVersion: number;
  readonly latestStatus: QuestionStatus;
  readonly publishedAt: string | null;
  /** The latest version's localized label, or `null` when that version is missing. */
  readonly label: LocalizedText | null;
  /** The latest version's type, or `null` when that version is missing. */
  readonly type: QuestionType | null;
  /**
   * Every stored version, oldest first: present only for `?versions=all` (issue #684).
   *
   * Optional and absent rather than empty, matching the route, so "this response does not
   * carry versions" and "this question has none" stay two different answers. The library
   * screen never asks for them; the form builder asks for nothing else, which is what
   * removed its detail read per question.
   */
  readonly versions?: readonly QuestionVersion[];
}

/** `GET /admin/questions/{id}`, versions oldest first. */
export interface QuestionDetail {
  readonly questionId: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly versions: readonly QuestionVersion[];
}

/**
 * One kernel validation issue (`details.issues[]` of `INVALID_QUESTION_DEFINITION`).
 *
 * `path` is what makes an error land inline: it is a domain path into the definition
 * (`["constraints","maxSelected"]`, `["options", 1, "optionId"]`), and the editor maps
 * it onto the field that produced it.
 */
export interface DefinitionIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

/** A rendered A2UI preview document, as `GET .../preview` returns it. */
export interface PreviewDocument {
  readonly stepId: string;
  readonly root: unknown;
  readonly a2uiSpecVersion: string;
  readonly compilerVersion: string;
}
