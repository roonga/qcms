import { t, type MessageKey } from "../i18n/en";

import type { AgentScreen, ResolvedScreen } from "./screens";

/** Name screen-specific context and omitted respondent answers so the operator can see what each turn shares. */
const CHIPS: Readonly<Record<AgentScreen, MessageKey>> = {
  "/forms": "agent.context.forms",
  "/forms/new": "agent.context.forms.new",
  "/forms/[formId]": "agent.context.form.draft",
  "/forms/[formId]/rules": "agent.context.form.rules",
  "/forms/[formId]/preview": "agent.context.form.preview",
  "/forms/[formId]/versions": "agent.context.form.versions",
  "/forms/[formId]/versions/[version]": "agent.context.form.version",
  "/forms/[formId]/publish": "agent.context.form.publish",
  "/operations/forms/[formId]/links": "agent.context.form.links",
  "/operations/forms/[formId]/webhooks": "agent.context.form.webhooks",
  "/operations/forms/[formId]/responses": "agent.context.form.responses",
  "/operations/forms/[formId]/responses/[sessionId]": "agent.context.form.response",
  "/operations/forms/[formId]/intake": "agent.context.form.intake",
  "/operations/forms/[formId]/erase": "agent.context.form.erase",
  "/questions": "agent.context.questions",
  "/questions/new": "agent.context.questions.new",
  "/questions/[questionId]": "agent.context.question",
  "/me/access": "agent.context.access",
  "/operations": "agent.context.operations",
  "/responses": "agent.context.responses",
  "/responses/erasures": "agent.context.erasures",
  "/settings": "agent.context.settings",
  "/webhooks": "agent.context.webhooks",
  "/workspaces": "agent.context.workspaces",
  "/workspaces/[workspaceId]/members": "agent.context.workspace.members",
  "/workspaces/[workspaceId]/access-groups": "agent.context.workspace.accessGroups",
  "/workspaces/[workspaceId]/settings": "agent.context.workspace.settings",
  "/workspaces/[workspaceId]/audit": "agent.context.workspace.audit",
  "/workspaces/[workspaceId]/assistant-actions": "agent.context.workspace.assistantActions",
};

export function contextChipKey(screen: AgentScreen): MessageKey {
  return CHIPS[screen];
}

/** Only the builder knows a subject title locally; other screens use route IDs because the API does not send context facts back. */
export function contextChipLabel(resolved: ResolvedScreen | undefined, subject?: string): string {
  if (resolved === undefined) return t("agent.context.none");
  const { params } = resolved;
  const id = params.formId ?? params.questionId ?? params.workspaceId ?? "";
  const named = subject !== undefined && subject.trim() !== "" ? subject.trim() : id;
  return t(contextChipKey(resolved.screen), {
    subject: named,
    version: params.version ?? "",
    session: params.sessionId ?? "",
  });
}
