import { t, type MessageKey } from "../i18n/en";

import type { AgentScreen, ResolvedScreen } from "./screens";

/**
 * The context chip's words, per screen (section 4.8).
 *
 * The chip is the operator's answer to "what can it see from here", so it is one line per
 * screen rather than one line for the whole app: a chip that says the same thing on the
 * response list and on Settings tells nobody which facts the turn will carry. Several of
 * the lines also name what the screen's facts leave out, because "no answers" is the
 * property this phase makes hold everywhere (principle point 4).
 *
 * The record is keyed by the screen type, so a screen added to `AGENT_SCREENS` without a
 * line here fails to typecheck rather than falling back to a generic string.
 */
const CHIPS: Readonly<Record<AgentScreen, MessageKey>> = {
  "/forms": "agent.context.forms",
  "/forms/new": "agent.context.forms.new",
  "/forms/[formId]": "agent.context.form.draft",
  "/forms/[formId]/rules": "agent.context.form.rules",
  "/forms/[formId]/preview": "agent.context.form.preview",
  "/forms/[formId]/versions": "agent.context.form.versions",
  "/forms/[formId]/versions/[version]": "agent.context.form.version",
  "/forms/[formId]/releases": "agent.context.form.releases",
  "/forms/[formId]/links": "agent.context.form.links",
  "/forms/[formId]/webhooks": "agent.context.form.webhooks",
  "/forms/[formId]/responses": "agent.context.form.responses",
  "/forms/[formId]/responses/[sessionId]": "agent.context.form.response",
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
  "/workspaces/[workspaceId]": "agent.context.workspace",
};

export function contextChipKey(screen: AgentScreen): MessageKey {
  return CHIPS[screen];
}

/**
 * The chip for the screen the operator is on.
 *
 * `subject` is the name the screen itself already knows, which on the builder is the
 * draft's own title; everywhere else the route id is the only truthful name the browser
 * holds, because a turn sends ids and the API never sends facts back (section 5.1).
 */
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
