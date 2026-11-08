/**
 * The words an audit row is read in. The tables store wire vocabulary: a kind such as
 * `access.grant`, a route pattern as the screen, and one opaque id as the detail. Nothing
 * here changes what is stored; it only says what each stored value means.
 */

import type { AgentScreen } from "../agent/screens.ts";
import { t, tPlural, type MessageKey } from "../i18n/en.ts";

import { groupTitle } from "./access-group-form.ts";
import type { AgentAuditRow } from "./types.ts";

const AUDIT_KINDS: Readonly<Record<string, MessageKey>> = {
  read: "membership.audit.kind.read",
  export: "membership.audit.kind.export",
  erasure: "membership.audit.kind.erasure",
  grant: "membership.audit.kind.grant",
  revoke: "membership.audit.kind.revoke",
  setting: "membership.audit.kind.setting",
};

/** One access-audit act in words; an unfamiliar wire value is shown as it arrived rather than hidden. */
export function auditKindLabel(kind: string): string {
  const key = AUDIT_KINDS[kind];
  return key === undefined ? kind : t(key);
}

/**
 * What a kind's audit row carries as its one `detail`, which is the result field a later step
 * of the same plan may reference. The API's action-kind registry owns the choice; this names it.
 */
type DetailField =
  | "challengeRequired"
  | "count"
  | "deliveryId"
  | "environment"
  | "formId"
  | "linkId"
  | "questionId"
  | "reason"
  | "teamId"
  | "userId"
  | "version"
  | "webhookId"
  | "workspaceId";

interface ActionWording {
  readonly act: MessageKey;
  readonly detail?: DetailField;
}

const ACTIONS: Readonly<Record<string, ActionWording>> = {
  "form.create": { act: "membership.agentAudit.act.form.create", detail: "formId" },
  "apply-draft": { act: "membership.agentAudit.act.apply-draft" },
  "form.saveDraft": { act: "membership.agentAudit.act.form.saveDraft", detail: "formId" },
  "form.publish": { act: "membership.agentAudit.act.form.publish", detail: "version" },
  "form.release": { act: "membership.agentAudit.act.form.release", detail: "version" },
  "form.settings": {
    act: "membership.agentAudit.act.form.settings",
    detail: "challengeRequired",
  },
  "form.close": { act: "membership.agentAudit.act.form.close", detail: "environment" },
  "form.reopen": { act: "membership.agentAudit.act.form.reopen", detail: "environment" },
  "link.mint": { act: "membership.agentAudit.act.link.mint", detail: "count" },
  "link.revoke": { act: "membership.agentAudit.act.link.revoke", detail: "linkId" },
  "response.erase": { act: "membership.agentAudit.act.response.erase", detail: "reason" },
  "response.unflag": { act: "membership.agentAudit.act.response.unflag" },
  "response.export": { act: "membership.agentAudit.act.response.export" },
  "webhook.create": { act: "membership.agentAudit.act.webhook.create", detail: "webhookId" },
  "webhook.rotate": { act: "membership.agentAudit.act.webhook.rotate", detail: "webhookId" },
  "webhook.retarget": { act: "membership.agentAudit.act.webhook.retarget", detail: "webhookId" },
  "webhook.reactivate": {
    act: "membership.agentAudit.act.webhook.reactivate",
    detail: "webhookId",
  },
  "webhook.deactivate": {
    act: "membership.agentAudit.act.webhook.deactivate",
    detail: "webhookId",
  },
  "webhook.redeliver": { act: "membership.agentAudit.act.webhook.redeliver", detail: "deliveryId" },
  "question.create": { act: "membership.agentAudit.act.question.create", detail: "questionId" },
  "question.saveDraft": { act: "membership.agentAudit.act.question.saveDraft", detail: "version" },
  "question.publish": { act: "membership.agentAudit.act.question.publish", detail: "version" },
  "question.deprecate": { act: "membership.agentAudit.act.question.deprecate", detail: "version" },
  "question.newVersion": {
    act: "membership.agentAudit.act.question.newVersion",
    detail: "version",
  },
  "access.groupCreate": { act: "membership.agentAudit.act.access.groupCreate", detail: "teamId" },
  "access.groupRemove": { act: "membership.agentAudit.act.access.groupRemove", detail: "teamId" },
  "access.grant": { act: "membership.agentAudit.act.access.grant", detail: "teamId" },
  "access.revoke": { act: "membership.agentAudit.act.access.revoke", detail: "userId" },
  "member.role": { act: "membership.agentAudit.act.member.role", detail: "userId" },
  "workspace.settings": {
    act: "membership.agentAudit.act.workspace.settings",
    detail: "workspaceId",
  },
};

const DETAIL_LABELS: Readonly<Record<DetailField, MessageKey>> = {
  challengeRequired: "agent.card.arg.challengeRequired",
  count: "agent.card.arg.count",
  deliveryId: "agent.card.arg.deliveryId",
  environment: "agent.card.arg.environment",
  formId: "agent.card.arg.formId",
  linkId: "agent.card.arg.linkId",
  questionId: "agent.card.arg.questionId",
  reason: "agent.card.arg.reason",
  teamId: "agent.card.arg.teamId",
  userId: "agent.card.arg.userId",
  version: "agent.card.arg.version",
  webhookId: "agent.card.arg.webhookId",
  workspaceId: "agent.card.arg.workspaceId",
};

const SCREEN_LABELS: Readonly<Record<AgentScreen, MessageKey>> = {
  "/forms": "nav.forms",
  "/forms/new": "forms.create.title",
  "/forms/[formId]": "forms.tab.builder",
  "/forms/[formId]/rules": "forms.tab.rules",
  "/forms/[formId]/preview": "forms.tab.preview",
  "/forms/[formId]/versions": "forms.tab.versions",
  "/forms/[formId]/versions/[version]": "forms.tab.versions",
  "/forms/[formId]/publish": "forms.tab.publish",
  "/operations/forms/[formId]/links": "forms.tab.links",
  "/operations/forms/[formId]/webhooks": "forms.tab.webhooks",
  "/operations/forms/[formId]/responses": "forms.tab.responses",
  "/operations/forms/[formId]/responses/[sessionId]": "forms.tab.responses",
  "/operations/forms/[formId]/availability": "forms.tab.availability",
  "/operations/forms/[formId]/erase": "forms.tab.erase",
  "/questions": "nav.questions",
  "/questions/new": "questions.create.title",
  "/questions/[questionId]": "membership.agentAudit.screen.question",
  "/me/access": "access.title",
  "/operations": "nav.operations",
  "/responses": "nav.operations",
  "/responses/erasures": "operations.queue.erasureLog",
  "/settings": "settings.title",
  "/webhooks": "operations.queue.deliveryFailures",
  "/workspaces": "membership.area.title",
  "/workspaces/all": "membership.workspace.allWorkspaces",
  "/workspaces/[workspaceId]/members": "membership.members.heading",
  "/workspaces/[workspaceId]/access-groups": "membership.groups.heading",
  "/workspaces/[workspaceId]/settings": "membership.settings.heading",
  "/workspaces/[workspaceId]/audit": "membership.audit.heading",
  "/workspaces/[workspaceId]/assistant-actions": "membership.agentAudit.heading",
};

/** One assistant act in words; an unfamiliar wire value is shown as it arrived. */
export function agentActLabel(kind: string): string {
  const wording = ACTIONS[kind];
  return wording === undefined ? kind : t(wording.act);
}

const BY_SCREEN: Readonly<Record<string, MessageKey>> = SCREEN_LABELS;

/** The screen a step reached, by the name it carries there; an unknown route reads as its pattern. */
export function agentScreenLabel(screen: string): string {
  const key = BY_SCREEN[screen];
  return key === undefined ? screen : t(key);
}

/** The names a row's own ids resolve through, read from this workspace's groups and members. */
export interface AgentAuditNames {
  readonly groups: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
}

export interface AgentStepDetail {
  readonly label: string;
  readonly value: string;
}

export function groupTitlesById(
  groups: readonly {
    readonly teamId: string;
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
  }[],
): ReadonlyMap<string, string> {
  return new Map(groups.map((group) => [group.teamId, groupTitle(group)]));
}

export function emailsById(
  members: readonly { readonly userId: string; readonly email: string }[],
): ReadonlyMap<string, string> {
  return new Map(members.map((member) => [member.userId, member.email]));
}

/**
 * A step's one detail, said in words: what the stored value is, then the value. A group or a
 * person it names is resolved to a name, and one taken down since is marked as removed rather
 * than dropped, because the act still happened.
 */
export function agentStepDetail(
  kind: string,
  detail: string | null,
  names: AgentAuditNames,
): AgentStepDetail | undefined {
  const field = ACTIONS[kind]?.detail;
  if (field === undefined || detail === null || detail === "") return undefined;
  const label = t(DETAIL_LABELS[field]);
  if (field === "teamId" || field === "userId") {
    const known = (field === "teamId" ? names.groups : names.people).get(detail);
    return {
      label,
      value: known ?? t("membership.agentAudit.removed", { id: detail }),
    };
  }
  return { label, value: detail };
}

/** One plan the assistant proposed, and the steps of it a person confirmed. */
export interface AgentActionPlan {
  readonly proposalId: string;
  readonly heading: string;
  readonly steps: readonly AgentAuditRow[];
}

function actorOf(row: AgentAuditRow): string {
  return row.actorEmail ?? t("membership.agentAudit.unknownActor", { actor: row.actor });
}

/**
 * The rows grouped into the plans they belong to, newest plan first and each plan's steps in
 * the order they ran. A step number means something only beside the plan it counts within.
 */
export function agentActionPlans(rows: readonly AgentAuditRow[]): readonly AgentActionPlan[] {
  const order: string[] = [];
  const byProposal = new Map<string, AgentAuditRow[]>();
  for (const row of rows) {
    const steps = byProposal.get(row.proposalId);
    if (steps === undefined) {
      order.push(row.proposalId);
      byProposal.set(row.proposalId, [row]);
    } else {
      steps.push(row);
    }
  }
  return order.map((proposalId) => {
    const steps = [...(byProposal.get(proposalId) ?? [])].sort(
      (left, right) => left.stepIndex - right.stepIndex,
    );
    const first = steps[0];
    return {
      proposalId,
      heading:
        first === undefined
          ? proposalId
          : tPlural(
              "membership.agentAudit.plan.one",
              "membership.agentAudit.plan.other",
              first.stepCount,
              { actor: actorOf(first) },
            ),
      steps,
    };
  });
}
