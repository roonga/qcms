import type { LocalizedText, QuestionDefinitionView, QuestionStatus } from "../questions/types.ts";

/**
 * The form builder's **view shapes** (task 033).
 *
 * ## Why these are structural mirrors rather than the kernel's own types
 *
 * The same reason 032's `questions/types.ts` gives, plus one that is specific to a form
 * under construction.
 *
 * The kernel's `FormDefinition` is a *publishable* form: `steps` is `.min(1)` and each
 * step's `items` is `.min(1)`. A form the author has just created has zero steps, and a
 * step they have just added has zero pins - both states the author must pass through to
 * reach a legal form, and both of which the kernel's schema rejects outright. Typing the
 * working document as `FormDefinition` would mean either a cast on every render or
 * forbidding the empty state.
 *
 * The ids are plain strings for the second half of the same reason: a half-built draft
 * holds ids the kernel has not blessed yet, and branding them here would put a second
 * validator in the BFF (R2). The kernel is still the only thing that decides whether a
 * draft is legal; `analysis.ts` is the single module that crosses back, and the fuzz test
 * in `condition.test.ts` is what proves the editor only ever emits shapes it accepts.
 */

/** A pinned question inside a step: the R6 identity plus the frozen version it points at. */
export interface DraftPin {
  readonly questionId: string;
  readonly version: number;
}

/** One step of the working draft. `items` may be empty while it is being filled. */
export interface DraftStep {
  readonly stepId: string;
  readonly title: LocalizedText;
  readonly items: readonly DraftPin[];
}

/**
 * The condition tree, mirroring the kernel's closed union (`visibility-rule.ts`, ADR-03)
 * with plain-string ids.
 *
 * Closed here too, and deliberately: the structured editor renders one control set per
 * `op`, so a variant the kernel does not have could not be built by the pickers and a
 * variant it does have that were missing here would be unreachable in the UI. `contains`
 * and `containsAny` are multiChoice membership (ADR-21); `equals` on a multiChoice
 * question is whole-answer set equality, never containment, which is why its value is an
 * option-id array rather than a single id.
 */
export type DraftCondition =
  | { readonly op: "equals"; readonly questionId: string; readonly value: DraftAnswerValue }
  | { readonly op: "notEquals"; readonly questionId: string; readonly value: DraftAnswerValue }
  | { readonly op: "in"; readonly questionId: string; readonly values: readonly DraftAnswerValue[] }
  | { readonly op: "gt"; readonly questionId: string; readonly value: number | string }
  | { readonly op: "gte"; readonly questionId: string; readonly value: number | string }
  | { readonly op: "lt"; readonly questionId: string; readonly value: number | string }
  | { readonly op: "lte"; readonly questionId: string; readonly value: number | string }
  | { readonly op: "answered"; readonly questionId: string }
  | { readonly op: "contains"; readonly questionId: string; readonly value: string }
  | { readonly op: "containsAny"; readonly questionId: string; readonly values: readonly string[] }
  | { readonly op: "and"; readonly conditions: readonly DraftCondition[] }
  | { readonly op: "or"; readonly conditions: readonly DraftCondition[] }
  | { readonly op: "not"; readonly condition: DraftCondition };

/** The canonical answer encodings a condition can compare against (`DOMAIN_SCHEMA` §2.4). */
export type DraftAnswerValue = string | number | boolean | readonly string[];

/** Every `op` the DSL carries, in the order the operator picker lists them. */
export const CONDITION_OPS = [
  "answered",
  "equals",
  "notEquals",
  "in",
  "contains",
  "containsAny",
  "gt",
  "gte",
  "lt",
  "lte",
  "and",
  "or",
  "not",
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

/** The ops that read one question (everything except the three combinators). */
export type LeafConditionOp = Exclude<ConditionOp, "and" | "or" | "not">;

/** One visibility rule of the working draft. */
export interface DraftRule {
  readonly ruleId: string;
  readonly when: DraftCondition;
  /** Question ids and step ids, mixed, exactly as the kernel's `show` allows. */
  readonly show: readonly string[];
}

/** The working document: a `FormDefinition` with the kernel's cardinality rules relaxed. */
export interface DraftForm {
  readonly formId: string;
  readonly defaultLocale: string;
  readonly title: LocalizedText;
  readonly steps: readonly DraftStep[];
  readonly rules: readonly DraftRule[];
}

/** The per-form abuse-control settings (ADR-24 tier 2, task 026). */
export interface FormSettings {
  readonly challengeRequired: boolean;
  /** The min-time floor override in milliseconds; `null` means "use the config default". */
  readonly minSubmitMs: number | null;
}

/** One row of `GET /admin/forms`. */
export interface FormListItem {
  readonly formId: string;
  readonly slug: string;
  readonly defaultLocale: string;
  readonly status: "open" | "closed";
  readonly hasDraft: boolean;
  readonly latestVersion: number | null;
  readonly publishedAt: string | null;
}

/** One published version's summary, newest first, as the detail response carries them. */
export interface FormVersionSummary {
  readonly version: number;
  readonly publishedAt: string;
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
  readonly semanticsVersion: string;
}

/**
 * `GET /admin/forms/{id}`.
 *
 * `draftSource` is worth reading before trusting `draft`: `"open"` means a saved draft
 * row, `"seeded"` means the API handed back the newest published definition as a starting
 * point that **is not stored yet**, and `"none"` means there is nothing at all.
 */
export interface FormDetail {
  readonly formId: string;
  readonly slug: string;
  readonly defaultLocale: string;
  readonly status: "open" | "closed";
  readonly draft: DraftForm | null;
  readonly draftSource: "open" | "seeded" | "none";
  readonly versions: readonly FormVersionSummary[];
  readonly settings: FormSettings;
  /**
   * The deployment's configured challenge provider (ADR-24). `"none"` is the default and
   * makes `challengeRequired` unenforceable, which the settings panel says out loud
   * rather than letting an author believe a switch is protecting them.
   */
  readonly challengeProvider: string;
}

/**
 * One publish issue, as `PUT .../draft` and `POST .../draft/validate` return them.
 *
 * The kernel models the codes and the API adds `DEPRECATED_PIN`; the route schema types
 * the array as `unknown`, so this is a view of the bytes rather than a re-declaration of
 * the union. `code` stays a plain `string` on purpose: a code this build has never heard
 * of must still render its message rather than disappear.
 *
 * `path` is the whole point. Every issue carries a *structured domain path* rather than a
 * positional index, which is what lets the validation panel turn an issue into a link
 * that moves focus to the rule, step, or pin that caused it (`issues.ts`).
 */
export interface FormIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: IssuePath | undefined;
}

/** The union of every field the issue paths use. Each code populates a subset. */
export interface IssuePath {
  readonly rule?: string | undefined;
  readonly rules?: readonly string[] | undefined;
  readonly step?: string | undefined;
  readonly question?: string | undefined;
  readonly option?: string | undefined;
  readonly target?: string | undefined;
  readonly locale?: string | undefined;
  readonly version?: number | undefined;
}

/**
 * A question the builder can pin, with every version it could pin to.
 *
 * Assembled in the BFF from `GET /admin/questions` plus a detail read per question,
 * because the list route reports only the *latest* version and its status: a question
 * whose latest version is a draft on top of a published v1 shows `latestStatus: "draft"`
 * and gives no hint that v1 exists and is pinnable. The picker and the "move pin" menu
 * both need the full version list, so it is fetched once and shared.
 */
export interface PinnableQuestion {
  readonly questionId: string;
  readonly slug: string;
  readonly label: LocalizedText | null;
  readonly type: string | null;
  /** Every version, oldest first, with the status that decides whether it is pinnable. */
  readonly versions: readonly PinnableVersion[];
}

export interface PinnableVersion {
  readonly version: number;
  readonly status: QuestionStatus;
  readonly definition: QuestionDefinitionView;
}
