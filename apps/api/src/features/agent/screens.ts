import type { z } from "zod";

import { administrationContexts } from "./contexts/administration.js";
import { authoringContexts } from "./contexts/authoring.js";
import { operationsContexts } from "./contexts/operations.js";
import type { ScreenBuildInput } from "./contexts/support.js";
import type { AgentToolName } from "./tools/registry.js";

/**
 * The frozen registry of admin screens: one row per `(shell)` page, holding its context
 * builder, its read tools and its action kinds. A screen id is the admin route pattern,
 * so the admin's table and this registry are checked against one route tree. A turn's
 * tool set is this registry intersected with the current screen's list (SEC-17).
 */
export const SCREEN_IDS = [
  "/forms",
  "/forms/new",
  "/forms/[formId]",
  "/forms/[formId]/rules",
  "/forms/[formId]/preview",
  "/forms/[formId]/versions",
  "/forms/[formId]/versions/[version]",
  "/forms/[formId]/publish",
  "/forms/[formId]/links",
  "/forms/[formId]/webhooks",
  "/forms/[formId]/responses",
  "/forms/[formId]/responses/[sessionId]",
  "/questions",
  "/questions/new",
  "/questions/[questionId]",
  "/me/access",
  "/operations",
  "/responses",
  "/responses/erasures",
  "/settings",
  "/webhooks",
  "/workspaces",
  "/workspaces/[workspaceId]",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

const IDS: ReadonlySet<string> = new Set<string>(SCREEN_IDS);

export function isScreenId(value: string): value is ScreenId {
  return IDS.has(value);
}

export interface ScreenDef {
  /**
   * The facts schema: `z.strictObject` with enumerated fields, which is what makes "no
   * answer value" a property of the shape rather than of a prompt.
   */
  readonly facts: z.ZodType;
  /** Checks its own SEC-3 cell before it reads anything. */
  build(input: ScreenBuildInput): Promise<unknown>;
  readonly readTools: readonly AgentToolName[];
  /** A screen with no action kind offers explanation and navigation. */
  readonly actionKinds: readonly string[];
}

/** The builder's own four verbs. */
const DRAFT_TOOLS: readonly AgentToolName[] = [
  "search_question_library",
  "propose_questions",
  "propose_draft",
  "validate_draft",
];

const NONE: readonly string[] = [];

function screen(
  context: {
    readonly facts: z.ZodType;
    readonly build: (input: ScreenBuildInput) => Promise<unknown>;
  },
  readTools: readonly AgentToolName[] = [],
): ScreenDef {
  return {
    facts: context.facts,
    build: (input) => context.build(input),
    readTools,
    actionKinds: NONE,
  };
}

/** Frozen so nothing can graft a screen, a tool or an action kind on at runtime. */
export const SCREENS: Readonly<Record<ScreenId, ScreenDef>> = Object.freeze({
  "/forms": screen(authoringContexts.formsList),
  "/forms/new": screen(authoringContexts.newForm),
  "/forms/[formId]": screen(authoringContexts.builder, DRAFT_TOOLS),
  "/forms/[formId]/rules": screen(authoringContexts.rules),
  "/forms/[formId]/preview": screen(authoringContexts.preview, ["project_draft"]),
  "/forms/[formId]/versions": screen(authoringContexts.versions),
  "/forms/[formId]/versions/[version]": screen(authoringContexts.versionDetail),
  "/forms/[formId]/publish": screen(authoringContexts.releases),
  "/forms/[formId]/links": screen(authoringContexts.links),
  "/forms/[formId]/webhooks": screen(operationsContexts.formWebhooks),
  "/forms/[formId]/responses": screen(operationsContexts.responseList),
  "/forms/[formId]/responses/[sessionId]": screen(operationsContexts.responseDetail),
  "/questions": screen(authoringContexts.questions),
  "/questions/new": screen(authoringContexts.newQuestion),
  "/questions/[questionId]": screen(authoringContexts.questionDetail),
  "/me/access": screen(administrationContexts.myAccess),
  "/operations": screen(operationsContexts.operations),
  "/responses": screen(operationsContexts.responsePicker),
  "/responses/erasures": screen(operationsContexts.erasures),
  "/settings": screen(administrationContexts.settings),
  "/webhooks": screen(operationsContexts.deadLetters),
  "/workspaces": screen(administrationContexts.workspaces),
  "/workspaces/[workspaceId]": screen(administrationContexts.workspaceDetail),
});

/** The screens of one form's subtree, which is the span of one conversation. */
export const FORM_SUBTREE_SCREENS: readonly ScreenId[] = SCREEN_IDS.filter((id) =>
  id.startsWith("/forms/[formId]"),
);

export function isFormSubtreeScreen(screenId: ScreenId): boolean {
  return FORM_SUBTREE_SCREENS.includes(screenId);
}
