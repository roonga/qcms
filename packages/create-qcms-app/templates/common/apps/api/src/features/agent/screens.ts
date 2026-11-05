import type { z } from "zod";

import { administrationContexts } from "./contexts/administration.js";
import { authoringContexts } from "./contexts/authoring.js";
import { operationsContexts } from "./contexts/operations.js";
import type { ScreenBuildInput } from "./contexts/support.js";
import type { AgentToolName } from "./tools/registry.js";

/**
 * Intersect the current screen's declared tool set with the registry so a turn cannot gain tools from
 * another screen.
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
  readonly readTools: readonly AgentToolName[];
  /** A screen with no action kind offers explanation and navigation. */
  readonly actionKinds: readonly string[];
}

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
  actionKinds: readonly string[] = NONE,
): ScreenDef {
  return {
    facts: context.facts,
    build: (input) => context.build(input),
    readTools,
    actionKinds,
  };
}

/** Frozen so nothing can graft a screen, a tool or an action kind on at runtime. */
export const SCREENS: Readonly<Record<ScreenId, ScreenDef>> = Object.freeze({
  "/forms": screen(authoringContexts.formsList, ["search_forms"], ["form.create"]),
  "/forms/new": screen(authoringContexts.newForm, [], ["form.create"]),
  "/forms/[formId]": screen(authoringContexts.builder, DRAFT_TOOLS, [
    "apply-draft",
    "form.publish",
    "form.settings",
  ]),
  "/forms/[formId]/rules": screen(authoringContexts.rules, ["validate_draft", "test_rule"]),
  "/forms/[formId]/preview": screen(authoringContexts.preview, ["project_draft"]),
  "/forms/[formId]/versions": screen(authoringContexts.versions, ["diff_form_versions"]),
  "/forms/[formId]/versions/[version]": screen(authoringContexts.versionDetail, [
    "diff_form_versions",
  ]),
  "/forms/[formId]/publish": screen(authoringContexts.releases, [], ["form.release"]),
  "/operations/forms/[formId]/links": screen(
    authoringContexts.links,
    ["count_links"],
    ["link.mint", "link.revoke"],
  ),
  "/operations/forms/[formId]/webhooks": screen(
    operationsContexts.formWebhooks,
    ["delivery_status"],
    [
      "webhook.create",
      "webhook.rotate",
      "webhook.retarget",
      "webhook.reactivate",
      "webhook.deactivate",
      "webhook.redeliver",
    ],
  ),
  "/operations/forms/[formId]/responses": screen(
    operationsContexts.responseList,
    ["list_responses", "count_responses"],
    ["response.export"],
  ),
  "/operations/forms/[formId]/responses/[sessionId]": screen(
    operationsContexts.responseDetail,
    [],
    ["response.erase", "response.unflag"],
  ),
  "/operations/forms/[formId]/intake": screen(
    operationsContexts.formIntake,
    [],
    ["form.close", "form.reopen"],
  ),
  "/operations/forms/[formId]/erase": screen(operationsContexts.formErase),
  "/questions": screen(
    authoringContexts.questions,
    ["search_question_library"],
    ["question.create"],
  ),
  "/questions/new": screen(
    authoringContexts.newQuestion,
    ["search_question_library"],
    ["question.create"],
  ),
  "/questions/[questionId]": screen(
    authoringContexts.questionDetail,
    ["search_question_library", "diff_question_versions"],
    ["question.saveDraft", "question.publish", "question.deprecate", "question.newVersion"],
  ),
  "/me/access": screen(administrationContexts.myAccess),
  "/operations": screen(operationsContexts.operations),
  "/responses": screen(operationsContexts.responsePicker),
  "/responses/erasures": screen(operationsContexts.erasures),
  "/settings": screen(administrationContexts.settings),
  "/webhooks": screen(operationsContexts.deadLetters, ["count_dead_letters"]),
  "/workspaces": screen(administrationContexts.workspaces),
  // One workspace's sections share one set of facts, and each offers only its own kinds.
  "/workspaces/[workspaceId]/members": screen(administrationContexts.workspaceDetail, [], [
    "member.role",
  ]),
  "/workspaces/[workspaceId]/access-groups": screen(administrationContexts.workspaceDetail, [], [
    "access.groupCreate",
    "access.groupRemove",
    "access.grant",
    "access.revoke",
  ]),
  "/workspaces/[workspaceId]/settings": screen(administrationContexts.workspaceDetail, [], [
    "workspace.settings",
  ]),
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

const BUILDER_SCREEN: ScreenId = "/forms/[formId]";

/**
 * Publishing a question the builder's own saved draft pins unpublished. The control lives
 * on the question's own page and the step still runs that page's action; what the builder
 * adds is the offer, and the propose tool refuses any other question id.
 */
const DRAFT_QUESTION_ACTION_KINDS: readonly string[] = Object.freeze(["question.publish"]);

function kindsAcross(ids: readonly ScreenId[]): readonly string[] {
  const kinds: string[] = [];
  for (const id of ids) {
    for (const kind of SCREENS[id].actionKinds) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  return Object.freeze(kinds);
}

const FORM_AUTHORING_ACTION_KINDS = kindsAcross(FORM_AUTHORING_SCREENS);
const FORM_OPERATIONS_ACTION_KINDS = kindsAcross(FORM_OPERATIONS_SCREENS);

/**
 * The kinds a turn on this screen may propose: its own subtree's on a form-scoped screen,
 * so one plan can span it, and the screen's own elsewhere. The two form subtrees are
 * separate lists because an authoring plan edits a shared draft while an operational plan
 * acts in one environment, and a plan mixing them would be one confirmation spanning both.
 */
export function offerableActionKinds(screenId: ScreenId): readonly string[] {
  if (screenId === BUILDER_SCREEN) {
    return [...FORM_AUTHORING_ACTION_KINDS, ...DRAFT_QUESTION_ACTION_KINDS];
  }
  if (FORM_AUTHORING_SCREENS.includes(screenId)) return FORM_AUTHORING_ACTION_KINDS;
  if (FORM_OPERATIONS_SCREENS.includes(screenId)) return FORM_OPERATIONS_ACTION_KINDS;
  return SCREENS[screenId].actionKinds;
}
