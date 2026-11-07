import type {
  LocalizedText,
  QuestionDefinitionView,
  QuestionStatus,
  QuestionType,
} from "../questions/types.ts";

// Working drafts include empty intermediate states the kernel schema rejects; wire them as editor shapes rather than falsely asserting FormDefinition.

export interface DraftPin {
  readonly questionId: string;
  readonly version: number;
}

// Keep max optional while editing so an unanswered bound survives save and reload; publish enforces its presence.
export type DraftRepeatCount =
  | { readonly source: "fixed"; readonly count: number }
  | {
      readonly source: "fromAnswer";
      readonly questionId: string;
      readonly min: number;
      readonly max?: number | undefined;
    }
  | { readonly source: "open"; readonly min: number; readonly max?: number | undefined };

export const REPEAT_COUNT_SOURCES = ["fixed", "fromAnswer", "open"] as const;
export type RepeatCountSource = (typeof REPEAT_COUNT_SOURCES)[number];

export const REPEAT_PRESENTATIONS = ["stacked", "perInstanceStep", "table"] as const;
export type RepeatPresentation = (typeof REPEAT_PRESENTATIONS)[number];

// Groups hold pins only; nesting groups would violate the kernel's one-level repeat model.
export interface DraftGroup {
  readonly groupId: string;
  readonly label: LocalizedText;

  readonly instanceLabel: LocalizedText;
  readonly items: readonly DraftPin[];
  readonly count: DraftRepeatCount;
  readonly presentation: RepeatPresentation;
}

// Mirror the wire discriminator without inventing a translation.
export type DraftStepItem = DraftPin | DraftGroup;

export function isDraftGroup(item: DraftStepItem): item is DraftGroup {
  // Test groupId value, not key presence: a pin may carry groupId: undefined and must not be mistaken for a group.
  return typeof (item as { readonly groupId?: unknown }).groupId === "string";
}

export interface DraftStep {
  readonly stepId: string;
  readonly title: LocalizedText;
  readonly items: readonly DraftStepItem[];
}

// multiChoice equals is whole-answer set equality, distinct from contains and containsAny membership.
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
  | { readonly op: "anyInstance"; readonly groupId: string; readonly condition: DraftCondition }
  | { readonly op: "everyInstance"; readonly groupId: string; readonly condition: DraftCondition }
  | {
      readonly op: "instanceCount";
      readonly groupId: string;
      readonly compare: InstanceCountComparison;
      readonly value: number;
    };

export const INSTANCE_COUNT_COMPARISONS = ["equals", "gt", "gte", "lt", "lte"] as const;
export type InstanceCountComparison = (typeof INSTANCE_COUNT_COMPARISONS)[number];

export type DraftAnswerValue = string | number | boolean | readonly string[];

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

export type GroupConditionOp = "anyInstance" | "everyInstance" | "instanceCount";

export type LeafConditionOp = Exclude<ConditionOp, "and" | "or" | "not" | GroupConditionOp>;

export interface DraftRule {
  readonly ruleId: string;
  readonly when: DraftCondition;

  readonly show: readonly string[];
}

export interface DraftForm {
  readonly formId: string;
  readonly defaultLocale: string;
  readonly title: LocalizedText;
  readonly steps: readonly DraftStep[];
  readonly rules: readonly DraftRule[];
}

export interface FormSettings {
  readonly challengeRequired: boolean;

  readonly minSubmitMs: number | null;
}

/** The library's third reading: a form with no release in this environment. */
export const FORM_AVAILABILITIES = ["open", "closed", "unreleased"] as const;

export type FormAvailability = (typeof FORM_AVAILABILITIES)[number];

export const FORM_SORTS = ["slug-asc", "slug-desc", "published-desc", "published-asc"] as const;

export type FormSort = (typeof FORM_SORTS)[number];

export const DEFAULT_FORM_SORT: FormSort = "slug-asc";

export interface FormListItem {
  readonly formId: string;
  readonly slug: string;
  readonly workspaceId: string;
  readonly defaultLocale: string;
  readonly status: FormAvailability;
  readonly hasDraft: boolean;
  readonly latestVersion: number | null;
  readonly publishedAt: string | null;
}

export interface FormVersionSummary {
  readonly version: number;
  readonly publishedAt: string;
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
  readonly semanticsVersion: string;
  // The publishing account is the identity the production second-approver rule refuses; null means no recorded author.
  readonly publishedBy: string | null;
}

// A seeded draft is a published starting point, not a stored draft. Do not treat it as already saved.
export interface FormPublishingWorkflow {
  readonly enabled: boolean;
  readonly environment: string;
  readonly canEdit: boolean;
  readonly canPublish: boolean;
  readonly canRelease: boolean;
  readonly eligibleVersions: readonly number[];
  readonly preferredVersion: number | null;
  readonly currentVersion: number | null;
}

export interface FormDetail {
  readonly workflow?: FormPublishingWorkflow;
  readonly releasedDefinition?: DraftForm | null;
  readonly formId: string;
  readonly slug: string;
  readonly defaultLocale: string;
  readonly status: "open" | "closed";
  readonly draft: DraftForm | null;
  readonly draftSource: "open" | "seeded" | "none";
  readonly versions: readonly FormVersionSummary[];
  readonly settings: FormSettings;
  // Clients receive enforceability, never provider configuration.
  readonly challengeEnforceable: boolean;

  readonly draftAgentAssisted: boolean;

  readonly draftUpdatedAt: string | null;
  // The API supplies this form's second-approver policy because releasers may not read workspace administration.
  readonly requiresSecondApprover: boolean;
  // Default unknown write capability off so an older payload cannot expose an action the API would refuse.
  readonly canWriteDraft: boolean;
}

// Keep unfamiliar issue codes visible rather than narrowing them out.
export interface FormIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: IssuePath | undefined;
}

export interface IssuePath {
  readonly rule?: string | undefined;
  readonly rules?: readonly string[] | undefined;
  readonly step?: string | undefined;

  readonly group?: string | undefined;
  readonly question?: string | undefined;
  readonly option?: string | undefined;
  readonly target?: string | undefined;
  readonly locale?: string | undefined;
  readonly version?: number | undefined;
  // Name the exact unknown template token so the author can remove it.
  readonly placeholder?: string | undefined;

  readonly scopes?: readonly string[] | undefined;

  readonly outerGroup?: string | undefined;
  readonly innerGroup?: string | undefined;

  readonly targetGroup?: string | undefined;
  readonly readGroup?: string | undefined;
}

// Use versions=all: a latest draft can hide earlier published versions that remain pinnable.
export interface PinnableQuestion {
  readonly questionId: string;
  readonly slug: string;
  /** True for the shared library's own rows: pinnable into this form, editable only where they live. Absent when the read did not say. */
  readonly shared?: boolean;
  readonly label: LocalizedText | null;

  readonly type: QuestionType | null;

  readonly versions: readonly PinnableVersion[];
}

export interface PinnableVersion {
  readonly version: number;
  readonly status: QuestionStatus;
  readonly definition: QuestionDefinitionView;
}

// Only the renderer registry can validate the carried A2UI root.
export interface CompiledStep {
  readonly stepId: string;
  readonly root: unknown;
}

export interface PreviewFlow {
  readonly visibleSteps: readonly string[];
  // Inside groups, visible answer keys are instanceId/questionId; bare question ids cannot prune instances independently.
  readonly visibleQuestions: readonly string[];
  readonly complete: boolean;

  readonly rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[];
  // Per-instance pagination returns one view per live instance; keep the API's page list rather than guessing by step.
  readonly visibleStepViews?: readonly {
    readonly stepId: string;
    readonly instanceId: string | null;
  }[];
}

export interface DraftPreview {
  readonly documents: readonly CompiledStep[];
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
  readonly flow: PreviewFlow;
}

// Show stored audit documents, never a recompilation that could differ from what respondents saw.
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

export type LinkState = "active" | "consumed" | "expired" | "revoked";

// Bearer tokens are never stored or listed.
export interface SecureLink {
  readonly linkId: string;
  // Keep environment on each bearer-link row so its destination remains clear when read outside the page banner.
  readonly environment: string;
  readonly state: LinkState;
  readonly oneTime: boolean;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

// Keep bearer URLs only in the mint result; the API cannot reveal them again.
export interface MintedLink {
  readonly linkId: string;

  readonly environment: string;

  readonly url: string;
  readonly expiresAt: string;
}
