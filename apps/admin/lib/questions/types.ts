/**
 * The question library's **wire shapes** (task 032).
 *
 * These mirror the payloads the API's `/admin/questions` routes send and accept, and
 * they are deliberately hand-written rather than imported from `@qcms/core`.
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

/** A question definition as it travels over the wire. */
export interface QuestionDefinitionView {
  readonly questionId: string;
  readonly type: QuestionType;
  readonly label: LocalizedText;
  readonly help?: LocalizedText | undefined;
  readonly required?: boolean | undefined;
  readonly options?: readonly ChoiceOptionView[] | undefined;
  readonly constraints?: ConstraintsView | undefined;
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
