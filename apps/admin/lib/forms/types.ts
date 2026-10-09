import type {
  LocalizedText,
  QuestionDefinitionView,
  QuestionStatus,
  QuestionType,
} from "../questions/types.ts";

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
 * draft is legal, and it decides it in the API: the import-surface test refuses every
 * `@roonga/qcms-core` VALUE import in this app, so nothing here crosses back. The fuzz test in `condition.test.ts`
 * is what proves the editor only ever emits shapes the kernel accepts, and it can import
 * the kernel because a `.test.ts` is outside that scan.
 */

/** A pinned question inside a step: the R6 identity plus the frozen version it points at. */
export interface DraftPin {
  readonly questionId: string;
  readonly version: number;
}

/**
 * Where a repeating group's instance count comes from (ADR-42, Q4 as amended by Q14).
 *
 * Mirrors the kernel's `RepeatCount` with plain-string ids, and **`max` is optional here
 * for the same reason it is optional in the kernel's schema**: a draft an author is still
 * filling in has to round-trip through save and reload with the field empty, and publish
 * is where an `open` or `fromAnswer` group without one is refused (`REPEAT_MAX_MISSING`).
 * The group panel says the field is required where the author sets it rather than leaving
 * that refusal to arrive at publish, which is a statement about the CONTROL and not a
 * second validator (R2).
 *
 * A `fixed` count carries neither bound, because the number is both.
 */
export type DraftRepeatCount =
  | { readonly source: "fixed"; readonly count: number }
  | {
      readonly source: "fromAnswer";
      readonly questionId: string;
      readonly min: number;
      readonly max?: number | undefined;
    }
  | { readonly source: "open"; readonly min: number; readonly max?: number | undefined };

/** The three count sources, in the order the panel's radio group lists them. */
export const REPEAT_COUNT_SOURCES = ["fixed", "fromAnswer", "open"] as const;
export type RepeatCountSource = (typeof REPEAT_COUNT_SOURCES)[number];

/**
 * The three presentations one primitive carries (ADR-42): stacked (073), one step view
 * per instance (076) and a table (077).
 *
 * All three are offered by the panel, because the field is the kernel's and an author
 * choosing it is choosing a layout rather than a model. What sits BEHIND the table option
 * - the column view of the member list, and the library picker filtered to the allowed
 * cell types - belongs to task 077.
 */
export const REPEAT_PRESENTATIONS = ["stacked", "perInstanceStep", "table"] as const;
export type RepeatPresentation = (typeof REPEAT_PRESENTATIONS)[number];

/**
 * A repeating group inside a step's item list (ADR-42), as the builder edits it.
 *
 * `items` is an array of pins and nothing else: a group may not contain a group (Q13), so
 * the nesting depth is one here exactly as it is in the kernel, and there is no authoring
 * gesture anywhere in this app that could produce a deeper draft.
 */
export interface DraftGroup {
  readonly groupId: string;
  readonly label: LocalizedText;
  /** The instance heading template, carrying the one `{n}` placeholder ("Passenger {n}"). */
  readonly instanceLabel: LocalizedText;
  readonly items: readonly DraftPin[];
  readonly count: DraftRepeatCount;
  readonly presentation: RepeatPresentation;
}

/**
 * One entry of a step's item list: a pinned question, or a repeating group.
 *
 * Discriminated **without a tag**, by the disjoint required keys `questionId` and
 * `groupId`, which is the kernel's own choice and the one additivity depends on there
 * (`packages/core/src/step.ts`): a tag would make every form definition that parses today
 * fail to parse. Mirroring it here means a draft read off the wire needs no translation
 * step that could invent a discriminator the API never sent.
 */
export type DraftStepItem = DraftPin | DraftGroup;

/**
 * Whether a step item is a repeating group rather than a pinned question.
 *
 * The VALUE test rather than the key test, mirroring the kernel's `isRepeatGroup`: a pin
 * written with an explicit `groupId: undefined` carries the key, and treating it as a
 * group would silently lose its question.
 *
 * It lives in this module rather than in `./draft.ts` because it is the discriminator of
 * the union declared directly above it: every reader of `DraftStep.items` needs it, and
 * several of them (`issues.ts`, `subtree-rail.ts`) otherwise import nothing from the
 * mutation module at all.
 */
export function isDraftGroup(item: DraftStepItem): item is DraftGroup {
  // The VALUE test, and the widening read rather than `"groupId" in item`: a draft is bytes the
  // API sent, so a pin written with an explicit `groupId: undefined` carries the key, and the
  // key test alone would treat it as a group and lose its question. `DraftPin` declares no
  // `groupId` at all, so the narrowing read is what makes the runtime check expressible.
  return typeof (item as { readonly groupId?: unknown }).groupId === "string";
}

/** One step of the working draft. `items` may be empty while it is being filled. */
export interface DraftStep {
  readonly stepId: string;
  readonly title: LocalizedText;
  readonly items: readonly DraftStepItem[];
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
  | { readonly op: "not"; readonly condition: DraftCondition }
  // The three WHOLE-GROUP operators (ADR-42, ADR-03 as amended 2026-09-29). They carry a
  // `groupId` and no `questionId`, which is the property every walker over this union has
  // to know about: a `default:` branch reading `condition.questionId` reads `undefined`.
  //
  // The inside-out direction needs no member here at all, which is the design's own
  // economy: a rule whose target sits inside a group is evaluated once per live instance
  // and a reference to a question in that same group resolves to that instance's answer,
  // so the airline's per-passenger rule is an ORDINARY condition. The admin states the
  // scope on the rule instead of making the author encode it (`rule-sentence.ts`).
  | { readonly op: "anyInstance"; readonly groupId: string; readonly condition: DraftCondition }
  | { readonly op: "everyInstance"; readonly groupId: string; readonly condition: DraftCondition }
  | {
      readonly op: "instanceCount";
      readonly groupId: string;
      readonly compare: InstanceCountComparison;
      readonly value: number;
    };

/**
 * The comparison names `instanceCount` reuses as a FIELD rather than as a second
 * comparison vocabulary (ADR-03 as amended 2026-09-29), in the order its picker lists
 * them. The same five names the ordering operators carry, which is the point.
 */
export const INSTANCE_COUNT_COMPARISONS = ["equals", "gt", "gte", "lt", "lte"] as const;
export type InstanceCountComparison = (typeof INSTANCE_COUNT_COMPARISONS)[number];

/** The canonical answer encodings a condition can compare against (`DOMAIN_SCHEMA` §2.4). */
export type DraftAnswerValue = string | number | boolean | readonly string[];

/**
 * Every `op` the DSL carries, in the order the operator picker lists them.
 *
 * Sixteen since task 074 (ADR-03 as amended 2026-09-29). The three whole-group operators
 * come last because they are the only ones that read a GROUP rather than a question, so an
 * author scanning the list meets the twelve that apply to the question they are editing
 * before the three that change the subject.
 */
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
  "anyInstance",
  "everyInstance",
  "instanceCount",
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

/** The three ops that read a whole repeating group rather than one question. */
export type GroupConditionOp = "anyInstance" | "everyInstance" | "instanceCount";

/** The ops that read one question: everything but the combinators and the group reads. */
export type LeafConditionOp = Exclude<ConditionOp, "and" | "or" | "not" | GroupConditionOp>;

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

/**
 * Whether a form accepts new sessions. The library list filters on it (issue 686), so
 * it is a named type rather than an inline union repeated at every use.
 */
export type FormStatus = "open" | "closed";

/**
 * The orders `GET /admin/forms` guarantees (issue 686), in the order the Sort control
 * offers them. The API owns the ordering; this list is what the screen may ask for.
 */
export const FORM_SORTS = ["slug-asc", "slug-desc", "published-desc", "published-asc"] as const;

/** One of {@link FORM_SORTS}. */
export type FormSort = (typeof FORM_SORTS)[number];

/** The order the list uses when the URL names none. */
export const DEFAULT_FORM_SORT: FormSort = "slug-asc";

/** One row of `GET /admin/forms`. */
export interface FormListItem {
  readonly formId: string;
  readonly slug: string;
  readonly defaultLocale: string;
  readonly status: FormStatus;
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
   * Whether a challenge this deployment can actually verify stands behind a form's
   * `challengeRequired` (ADR-24). The API sends this derived boolean and never the
   * provider name: clients receive behavior, not flag values. `false` is the default
   * and the state the settings panel warns about out loud, rather than letting an
   * author believe a switch is protecting them.
   */
  readonly challengeEnforceable: boolean;
  /**
   * Task 041's provenance marker: whether the stored draft carries any agent-assisted
   * change. Shown on the builder and repeated in the publish confirmation (ADR-25) so
   * the human publishing knows what they are signing, before this visit's own edits
   * have said anything either way.
   */
  readonly draftAgentAssisted: boolean;
  /** The stored draft's `updatedAt`, task 041's `clientState` token for an assist call. */
  readonly draftUpdatedAt: string | null;
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
  /**
   * The repeating group an issue is about (ADR-42), which the kernel's own publish errors
   * populate for every `REPEAT_*` code and for `DANGLING_GROUP_REF`. Read by the group
   * panel so a refusal about a group's bounds, its label template or its count source is
   * shown on the controls that set them rather than only in the validation panel.
   */
  readonly group?: string | undefined;
  readonly question?: string | undefined;
  readonly option?: string | undefined;
  readonly target?: string | undefined;
  readonly locale?: string | undefined;
  readonly version?: number | undefined;
  /**
   * The placeholder an instance-label template carried that nothing substitutes
   * (`INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`). Named rather than only counted, because the
   * author's next act is to delete that exact token.
   */
  readonly placeholder?: string | undefined;
  /**
   * The scopes one rule's `show` list straddles (`RULE_TARGETS_SPAN_SCOPES`): group ids
   * and the literal `"form"` for a target outside every group.
   */
  readonly scopes?: readonly string[] | undefined;
  /** The outer and inner groups of a refused operator nest (`REPEAT_OPERATOR_NESTING_NOT_ALLOWED`). */
  readonly outerGroup?: string | undefined;
  readonly innerGroup?: string | undefined;
  /** The group a refused cross-group rule targets inside, and the one it reads whole. */
  readonly targetGroup?: string | undefined;
  readonly readGroup?: string | undefined;
}

/**
 * A question the builder can pin, with every version it could pin to.
 *
 * Assembled in the BFF from one `GET /admin/questions?versions=all`. The summary that
 * route reports by default cannot answer this: it carries only the *latest* version and
 * its status, so a question whose latest version is a draft on top of a published v1
 * shows `latestStatus: "draft"` and gives no hint that v1 exists and is pinnable. The
 * picker and the "move pin" menu both need the full version list, so it is fetched once
 * and shared.
 *
 * It used to be that list plus a **detail read per question**, which is `1 + N` API calls
 * on every builder page load with N the size of the whole library (issue #684). The
 * reasoning behind the fan-out was sound and its failure handling was careful; what was
 * missing was a route that could answer the question in one read, and `?versions=all` is
 * it.
 */
export interface PinnableQuestion {
  readonly questionId: string;
  readonly slug: string;
  readonly label: LocalizedText | null;
  /**
   * The question's type, or `null` when the library row carried none.
   *
   * `QuestionType` rather than `string`: the i18n catalog keys these as
   * `questions.type.<type>`, and a bare `string` widens that template literal past the
   * catalog's key union, so every caller that labels a type fails to compile. Narrowing
   * here rather than at each call site keeps the one validation in one place - the API
   * response is parsed into this shape once, in `lib/server/forms.ts`.
   */
  readonly type: QuestionType | null;
  /** Every version, oldest first, with the status that decides whether it is pinnable. */
  readonly versions: readonly PinnableVersion[];
}

export interface PinnableVersion {
  readonly version: number;
  readonly status: QuestionStatus;
  readonly definition: QuestionDefinitionView;
}

// --- publish, preview, versions and secure links (task 034) -----------------

/**
 * One compiled A2UI step document.
 *
 * `root` stays `unknown` on the way through this app on purpose: the node tree is
 * opaque to the API's schema and to this BFF alike, and the renderer's registry is the
 * only thing that knows what a node means. It is narrowed exactly once, at the renderer
 * (`@roonga/qcms-ui`'s own `A2UIStepDocument`), which is where that knowledge lives.
 */
export interface CompiledStep {
  readonly stepId: string;
  readonly root: unknown;
}

/** The forward-pass projection (ADR-16) the preview endpoint returns with the documents. */
export interface PreviewFlow {
  readonly visibleSteps: readonly string[];
  /**
   * The visible fields as ANSWER KEYS: a bare `questionId` outside every repeating group, and
   * `instanceId/questionId` inside one (ADR-42, ADR-43).
   *
   * The qualified form is what the renderer's repeat expansion prunes each instance's clone
   * against, and it is the identical projection the portal receives - which is the property
   * that keeps the preview's DOM the portal's DOM rather than a resemblance to it. A form with
   * no repeating group carries the byte-identical bare list it always did.
   */
  readonly visibleQuestions: readonly string[];
  readonly complete: boolean;
  /** The hypothetical roster the projection was computed with, per group (074). */
  readonly rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[];
  /**
   * The ADR-28 cursor's page list (task 076, Q22), present exactly when the draft holds a
   * repeating group and absent otherwise.
   *
   * A step paginated by a `perInstanceStep` group contributes one view per live instance,
   * so the preview's Previous and Next walk the pages a respondent walks rather than a
   * step-shaped approximation of them. `lib/forms/preview-views.ts` is the one place this
   * is read, so the pane and the portal cannot disagree about what a page is.
   */
  readonly visibleStepViews?: readonly {
    readonly stepId: string;
    readonly instanceId: string | null;
  }[];
}

/**
 * `POST /admin/forms/{id}/draft/preview` (034): the dry-run compile of the draft on the
 * author's screen, plus the visible set for the answers they walked in with.
 *
 * It is the same pair the portal's serve-step hands a respondent, which is what lets the
 * preview pane project and render through the identical shared code (ARCHITECTURE §6).
 * Nothing here is stored: ADR-18's audit copy is written only by publish.
 */
export interface DraftPreview {
  readonly documents: readonly CompiledStep[];
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
  readonly flow: PreviewFlow;
}

/**
 * `GET /admin/forms/{id}/versions/{v}` (034): one frozen version, whole.
 *
 * `documents` is the **stored** compiled A2UI, read out of the version's JSONB. History
 * renders that copy and never a recompilation, because the audit promise is "this is
 * what the respondent saw" and a recompile could only ever weaken it (ADR-18, R1).
 */
export interface FormVersionSnapshot {
  readonly formId: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
  readonly semanticsVersion: string;
  readonly definition: unknown;
  readonly documents: readonly CompiledStep[];
}

/** A secure link's lifecycle state, as the API derives it (024). */
export type LinkState = "active" | "consumed" | "expired" | "revoked";

/** One row of `GET /admin/forms/{id}/links`. The token itself is never stored or listed. */
export interface SecureLink {
  readonly linkId: string;
  readonly state: LinkState;
  readonly oneTime: boolean;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/**
 * One freshly minted link.
 *
 * `url` carries the signed token and exists **only in this response**: the API mints it,
 * never persists it, and cannot show it again. That is why the mint result list is a
 * distinct screen state with copy and CSV export on it, rather than a row in the table.
 */
export interface MintedLink {
  readonly linkId: string;
  readonly url: string;
  readonly expiresAt: string;
}
