import type { Condition } from "@qcms/core";

import type { LocalizedText, QuestionDefinitionView, QuestionStatus } from "../questions/types.ts";

/**
 * The form builder's view types (task 033).
 *
 * ## Why these are hand-written next to types the kernel already exports
 *
 * `@qcms/core` exports `FormDefinition`, and the builder does import it - for parsing and
 * for the advisory analysis (see `analysis.ts`). But a *draft under edit* is not a
 * `FormDefinition` and cannot be typed as one: a form the author has just created has zero
 * steps, and a step they have just added has zero pins, both of which the kernel's schema
 * rejects outright (`.min(1)` on `steps` and on `Step.items`). Typing the working document
 * as `FormDefinition` would mean either lying with a cast on every render or forbidding the
 * empty state the author has to pass through to reach a legal form.
 *
 * So the working document is `DraftForm`: the same field names and the same shape, with the
 * cardinality rules relaxed. It is deliberately structural rather than branded - the ids in
 * it are plain strings, because a half-built draft holds ids the kernel has not blessed yet.
 * `analysis.ts` is the one place that crosses back, parsing a `DraftForm` into a real
 * `FormDefinition` and reporting what the kernel said about it.
 *
 * `Condition` is the exception: it comes straight from the kernel, unrelaxed. The structured
 * pickers only ever emit complete conditions (a new rule starts as `answered`, which needs
 * no operand), so there is no partially-built condition state to model, and exit criterion 4
 * is exactly the promise that this stays true.
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

/** One visibility rule of the working draft. */
export interface DraftRule {
  readonly ruleId: string;
  readonly when: Condition;
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
 * `draftSource` is worth reading before trusting `draft`: `"open"` means a saved draft row,
 * `"seeded"` means the API handed back the newest published definition as a starting point
 * that **is not stored yet**, and `"none"` means there is nothing at all. The builder treats
 * `"seeded"` as dirty-from-birth, because the first save is what creates the row.
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
   * makes `challengeRequired` unenforceable, which the settings panel says out loud rather
   * than letting an author believe a switch is protecting them.
   */
  readonly challengeProvider: string;
}

/**
 * One publish issue, as `PUT .../draft` and `POST .../draft/validate` return them.
 *
 * The kernel models eleven codes and the API adds a twelfth (`DEPRECATED_PIN`), and the
 * route schema types the array as `unknown`, so this union is hand-written and has to stay
 * in step with `packages/core/src/publish-error.ts` plus the API's forms handler. It is
 * kept structural (plain `string` ids) for the same reason `DraftForm` is: an issue names
 * ids in a draft the kernel has not blessed.
 *
 * `path` is the whole point. Every code carries a *structured domain path* rather than a
 * positional index, which is what lets the validation panel turn an issue into a link that
 * moves focus to the rule, step, or pin that caused it (`issues.ts`).
 */
export type FormIssue =
  | { readonly code: "DANGLING_QUESTION_REF"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "DANGLING_OPTION_REF"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "DANGLING_STEP_REF"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "UNPUBLISHED_QUESTION_PIN"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "LOCALE_INCOMPLETE"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "RULE_BACKWARD_TARGET"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "RULE_CYCLE"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "RULE_DEPTH_EXCEEDED"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "RULE_TYPE_MISMATCH"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "DUPLICATE_QUESTION_IN_FORM"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "DUPLICATE_STEP_ID"; readonly message: string; readonly path: IssuePath }
  | { readonly code: "DEPRECATED_PIN"; readonly message: string; readonly path: IssuePath }
  | { readonly code: string; readonly message: string; readonly path?: IssuePath | undefined };

/** The union of every field the twelve issue paths use. Each code populates a subset. */
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
 * Assembled in the BFF from `GET /admin/questions` plus a detail read per question, because
 * the list route reports only the *latest* version and its status: a question whose latest
 * version is a draft on top of a published v1 shows `latestStatus: "draft"` and gives no
 * hint that v1 exists and is pinnable. The picker and the "move pin" menu both need the
 * full version list, so it is fetched once and shared.
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
