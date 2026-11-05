import type { z } from "zod";

import { administrationContexts } from "./contexts/administration.js";
import { authoringContexts } from "./contexts/authoring.js";
import { operationsContexts } from "./contexts/operations.js";
import type { ScreenBuildInput } from "./contexts/support.js";

/**
 * The screen registry. A screen is **context**: the facts it can show and the default
 * subject ids a tool call takes when it names none. It is not a permission list: what a
 * turn may read and propose is the caller's own grants (`docs/agent-principle.md`).
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
  "/operations/forms/[formId]/links",
  "/operations/forms/[formId]/webhooks",
  "/operations/forms/[formId]/responses",
  "/operations/forms/[formId]/responses/[sessionId]",
  "/operations/forms/[formId]/intake",
  "/operations/forms/[formId]/erase",
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
  "/workspaces/[workspaceId]/members",
  "/workspaces/[workspaceId]/access-groups",
  "/workspaces/[workspaceId]/settings",
  "/workspaces/[workspaceId]/audit",
  "/workspaces/[workspaceId]/assistant-actions",
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
  build(input: ScreenBuildInput): Promise<unknown>;
}

function screen(context: {
  readonly facts: z.ZodType;
  readonly build: (input: ScreenBuildInput) => Promise<unknown>;
}): ScreenDef {
  return { facts: context.facts, build: (input) => context.build(input) };
}

/** Frozen so nothing can graft a screen on at runtime. */
export const SCREENS: Readonly<Record<ScreenId, ScreenDef>> = Object.freeze({
  "/forms": screen(authoringContexts.formsList),
  "/forms/new": screen(authoringContexts.newForm),
  "/forms/[formId]": screen(authoringContexts.builder),
  "/forms/[formId]/rules": screen(authoringContexts.rules),
  "/forms/[formId]/preview": screen(authoringContexts.preview),
  "/forms/[formId]/versions": screen(authoringContexts.versions),
  "/forms/[formId]/versions/[version]": screen(authoringContexts.versionDetail),
  "/forms/[formId]/publish": screen(authoringContexts.releases),
  "/operations/forms/[formId]/links": screen(authoringContexts.links),
  "/operations/forms/[formId]/webhooks": screen(operationsContexts.formWebhooks),
  "/operations/forms/[formId]/responses": screen(operationsContexts.responseList),
  "/operations/forms/[formId]/responses/[sessionId]": screen(operationsContexts.responseDetail),
  "/operations/forms/[formId]/intake": screen(operationsContexts.formIntake),
  "/operations/forms/[formId]/erase": screen(operationsContexts.formErase),
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
  // One workspace's sections share one set of facts. Which kinds each offers is the
  // caller's own grants now, so every section is the same context builder.
  "/workspaces/[workspaceId]/members": screen(administrationContexts.workspaceDetail),
  "/workspaces/[workspaceId]/access-groups": screen(administrationContexts.workspaceDetail),
  "/workspaces/[workspaceId]/settings": screen(administrationContexts.workspaceDetail),
  "/workspaces/[workspaceId]/audit": screen(administrationContexts.workspaceDetail),
  "/workspaces/[workspaceId]/assistant-actions": screen(administrationContexts.workspaceDetail),
});

/** One form's authoring screens: the editor's own subtree. */
export const FORM_AUTHORING_SCREENS: readonly ScreenId[] = SCREEN_IDS.filter((id) =>
  id.startsWith("/forms/[formId]"),
);

/** One form's operational screens: each reads the environment the selection names. */
export const FORM_OPERATIONS_SCREENS: readonly ScreenId[] = SCREEN_IDS.filter((id) =>
  id.startsWith("/operations/forms/[formId]"),
);

export function isFormSubtreeScreen(screenId: ScreenId): boolean {
  return FORM_AUTHORING_SCREENS.includes(screenId) || FORM_OPERATIONS_SCREENS.includes(screenId);
}

/**
 * Whether a screen owns one environment's operational state rather than authoring content.
 * It is what the no-mixing rule partitions a plan's kinds by, independent of the screen the
 * turn is on (D2).
 */
export function isOperationalScreen(screenId: string): boolean {
  return screenId.startsWith("/operations/");
}
