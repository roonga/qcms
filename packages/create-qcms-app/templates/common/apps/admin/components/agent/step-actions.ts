"use client";

import {
  confirmPublishAction,
  createFormForCardAction,
  mintLinksAction,
  releaseVersionAction,
  reviewReleaseAction,
  revokeLinkAction,
  saveDraftAction as saveFormDraftAction,
  setFormStatusAction,
  updateSettingsAction,
} from "@/app/(shell)/forms/actions";
import {
  createQuestionForCardAction,
  createQuestionVersionForCardAction,
  lifecycleAction,
  saveDraftAction as saveQuestionDraftAction,
} from "@/app/(shell)/questions/actions";
import { eraseSessionAction, unflagResponseAction } from "@/app/(shell)/responses/actions";
import {
  createAccessGroupAction,
  grantAccessGroupAction,
  removeAccessGroupAction,
  revokeAccessGroupAction,
  saveWorkspaceSettingsAction,
  setMemberRoleAction,
} from "@/app/(shell)/workspaces/[workspaceId]/actions";
import {
  createWebhookAction,
  deactivateWebhookAction,
  reactivateWebhookAction,
  redeliverAction,
  retargetWebhookAction,
  rotateSecretAction,
} from "@/app/(shell)/webhooks/actions";
import { builderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import { acceptedDraft, proposalDiff } from "@/lib/forms/assist-diff";
import { isErasureReason } from "@/lib/ops/erasure";
import { IDLE_MUTATION } from "@/lib/questions/editor-state";
import type { MembershipActionState } from "@/lib/membership/types";
import type { WebhookActionState } from "@/components/ops/webhook-config";
import type { AgentStepIssue, AgentStepResult } from "@/lib/agent/plan-state";
import type { AgentPlanStep } from "@/lib/forms/assist-stream";
import type { DraftForm } from "@/lib/forms/types";
import type { RunStepRequest } from "@/lib/agent/runner";
import { t } from "@/lib/i18n/en";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" ? value : Number.parseInt(text(value, "1"), 10) || 1;
}

function countOf(definition: object, member: string): number {
  const value = (definition as Record<string, unknown>)[member];
  return Array.isArray(value) ? value.length : 0;
}

/* A step item is a pinned question or a repeating group holding them, never both. */
function pinnedCount(definition: object): number {
  const steps = (definition as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return 0;
  let total = 0;
  for (const step of steps) {
    const items = (step as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const nested = (item as { items?: unknown } | null)?.items;
      total += Array.isArray(nested) ? nested.length : 1;
    }
  }
  return total;
}

/* The API's own definition issues, kept as the authoring-boundary text they are. */
function stepIssues(
  issues:
    readonly { code: string; message: string; path?: readonly (string | number)[] }[] | undefined,
): readonly AgentStepIssue[] {
  return (issues ?? []).map((issue) => ({
    code: issue.code,
    message: issue.message,
    ...(issue.path === undefined || issue.path.length === 0 ? {} : { path: issue.path.join(".") }),
  }));
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function whole(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

type StepRunner = (request: RunStepRequest) => Promise<AgentStepResult>;

function proposalRef(
  agentProposal: string | undefined,
  tokenStep: number,
): { agentProposal: string; step: number } | undefined {
  return agentProposal === undefined ? undefined : { agentProposal, step: tokenStep };
}

const applyDraftRunner: StepRunner = ({ step }) => {
  const proposed = step.draft;
  const builder = builderAssistSnapshot();
  if (proposed === undefined || builder === undefined || !builder.canPropose) {
    return Promise.resolve({ outcome: "failed", message: t("agent.card.note.noBuilder") });
  }
  const diff = proposalDiff(builder.draft, proposed.definition, proposed.newQuestions);
  builder.accept(acceptedDraft(builder.draft, proposed.definition), proposed.newQuestions);
  return Promise.resolve({
    outcome: "done",
    result: { changes: diff.length, newQuestions: proposed.newQuestions.length },
  });
};

function intakeRunner(action: "close" | "reopen"): StepRunner {
  return async ({ step, tokenStep, args, agentProposal }) => {
    const state = await setFormStatusAction(
      text(args["formId"]),
      step.environment,
      action,
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "changed") {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: { status: state.formStatus, environment: state.environment },
    };
  };
}

function endpointOutcome(
  state: WebhookActionState,
  step: AgentPlanStep,
  webhookId: string,
): AgentStepResult {
  if (state.status === "error") {
    return { outcome: "failed", message: text(state.message) };
  }
  const revealed = state.revealed?.secret;
  const result = { webhookId, environment: step.environment };
  if (state.status === "pending") {
    return {
      outcome: "pending-approval",
      message: t("ops.proposals.stored", { environment: step.environment }),
      result,
      ...(revealed === undefined ? {} : { revealed }),
    };
  }
  return { outcome: "done", result, ...(revealed === undefined ? {} : { revealed }) };
}

/* Read review immediately before confirmation and forward both expectations; an intervening save must
   refuse without writes. */
const publishStep: StepRunner = async ({ step, tokenStep, args, agentProposal }) => {
  const formId = text(args["formId"]);
  const review = await reviewReleaseAction(formId, { kind: "draft" });
  if (!review.ok) return { outcome: "failed", message: t("agent.card.note.noDraftToPublish") };
  const source = review.data.source;
  const target = review.data.targets.find((entry) => entry.environment === step.environment);
  if (source.kind !== "draft" || target === undefined) {
    return { outcome: "failed", message: t("agent.card.note.noDraftToPublish") };
  }
  const state = await confirmPublishAction(
    formId,
    {
      idempotencyKey: crypto.randomUUID(),
      expectedWorkflowRevision: review.data.workflowRevision,
      source: { kind: "draft", draftRevision: source.draftRevision },
      targets: [{ environment: step.environment, expectedSequence: target.currentSequence }],
    },
    proposalRef(agentProposal, tokenStep),
  );
  if (state.status !== "done" || state.version === undefined) {
    return { outcome: "failed", message: text(state.message) };
  }
  return {
    outcome: "done",
    result: { version: state.version, environment: step.environment },
  };
};

function membershipOutcome(
  state: MembershipActionState,
  result: Readonly<Record<string, unknown>>,
): AgentStepResult {
  if (state.status !== "done") {
    return { outcome: "failed", message: state.status === "error" ? state.message : "" };
  }
  return { outcome: "done", result };
}

const MEMBERSHIP_RUNNERS: Readonly<Record<string, StepRunner>> = {
  "access.groupCreate": async ({ tokenStep, args, agentProposal }) => {
    const state = await createAccessGroupAction(
      text(args["workspaceId"]),
      {
        name: text(args["name"]),
        role: text(args["role"]),
        ...(typeof args["label"] === "string" ? { label: args["label"] } : {}),
        environments: strings(args["environments"]),
        forms: strings(args["forms"]),
      },
      proposalRef(agentProposal, tokenStep),
    );
    return membershipOutcome(state, {
      teamId: state.status === "done" ? text(state.teamId) : "",
      name: text(args["name"]),
      role: text(args["role"]),
    });
  },
  "access.groupRemove": async ({ tokenStep, args, agentProposal }) => {
    const state = await removeAccessGroupAction(
      text(args["workspaceId"]),
      text(args["teamId"]),
      proposalRef(agentProposal, tokenStep),
    );
    return membershipOutcome(state, { teamId: text(args["teamId"]) });
  },
  "access.grant": async ({ tokenStep, args, agentProposal }) => {
    const state = await grantAccessGroupAction(
      text(args["workspaceId"]),
      text(args["teamId"]),
      text(args["email"]),
      proposalRef(agentProposal, tokenStep),
    );
    return membershipOutcome(state, {
      teamId: text(args["teamId"]),
      name: state.status === "done" ? text(state.name) : "",
    });
  },
  "access.revoke": async ({ tokenStep, args, agentProposal }) => {
    const state = await revokeAccessGroupAction(
      text(args["workspaceId"]),
      text(args["teamId"]),
      text(args["userId"]),
      proposalRef(agentProposal, tokenStep),
    );
    return membershipOutcome(state, {
      teamId: text(args["teamId"]),
      userId: text(args["userId"]),
    });
  },
  "member.role": async ({ tokenStep, args, agentProposal }) => {
    const role = args["role"];
    if (role !== "forms.owner" && role !== "member") {
      return { outcome: "failed", message: t("agent.card.note.unknownRole") };
    }
    const state = await setMemberRoleAction(
      text(args["workspaceId"]),
      text(args["userId"]),
      role,
      proposalRef(agentProposal, tokenStep),
    );
    return membershipOutcome(state, { userId: text(args["userId"]), role });
  },
  "workspace.settings": async ({ tokenStep, args, agentProposal }) => {
    const state = await saveWorkspaceSettingsAction(
      text(args["workspaceId"]),
      // Send only settings the card showed; defaults would change unconfirmed values and invalidate the reviewed
      // digest.
      {
        ...(typeof args["requireSecondApprover"] === "boolean"
          ? { requireSecondApprover: args["requireSecondApprover"] }
          : {}),
        ...(typeof args["seedNewEditorsWithTestData"] === "boolean"
          ? { seedNewEditorsWithTestData: args["seedNewEditorsWithTestData"] }
          : {}),
      },
      proposalRef(agentProposal, tokenStep),
    );
    return membershipOutcome(state, {
      requireSecondApprover: state.status === "done" && state.requireSecondApprover === true,
      seedNewEditorsWithTestData:
        state.status === "done" && state.seedNewEditorsWithTestData === true,
    });
  },
};

function lifecycleRunner(intent: "publish" | "deprecate"): StepRunner {
  return async ({ tokenStep, args, agentProposal }) => {
    const version = whole(args["version"]);
    if (version === undefined) {
      return { outcome: "failed", message: t("agent.card.note.unresolvedReference") };
    }
    const body = new FormData();
    body.set("questionId", text(args["questionId"]));
    body.set("version", String(version));
    body.set("intent", intent);
    const state = await lifecycleAction(IDLE_MUTATION, body, proposalRef(agentProposal, tokenStep));
    if (state.status !== "saved") return { outcome: "failed", message: text(state.message) };
    return {
      outcome: "done",
      result: {
        questionId: text(args["questionId"]),
        version,
        status: intent === "publish" ? "published" : "deprecated",
      },
    };
  };
}

const QUESTION_RUNNERS: Readonly<Record<string, StepRunner>> = {
  "question.create": async ({ tokenStep, args, agentProposal }) => {
    const state = await createQuestionForCardAction(
      {
        slug: text(args["slug"]),
        definition: args["definition"],
        ...(typeof args["workspaceId"] === "string" ? { workspaceId: args["workspaceId"] } : {}),
      },
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "done" || state.questionId === undefined) {
      return {
        outcome: "failed",
        message: text(state.message),
        issues: stepIssues(state.issues),
      };
    }
    return {
      outcome: "done",
      result: {
        questionId: state.questionId,
        slug: text(state.slug),
        version: state.version ?? 1,
      },
    };
  },
  "question.saveDraft": async ({ tokenStep, args, agentProposal }) => {
    const version = whole(args["version"]);
    const definition = args["definition"];
    if (version === undefined || typeof definition !== "object" || definition === null) {
      return { outcome: "failed", message: t("agent.card.note.unresolvedReference") };
    }
    const body = new FormData();
    body.set("questionId", text(args["questionId"]));
    body.set("version", String(version));
    body.set("definition", JSON.stringify(definition));
    const state = await saveQuestionDraftAction(
      IDLE_MUTATION,
      body,
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "saved") {
      return { outcome: "failed", message: text(state.message), issues: stepIssues(state.issues) };
    }
    return {
      outcome: "done",
      result: { questionId: text(args["questionId"]), version, status: "draft" },
    };
  },
  "question.publish": lifecycleRunner("publish"),
  "question.deprecate": lifecycleRunner("deprecate"),
  "question.newVersion": async ({ tokenStep, args, agentProposal }) => {
    const state = await createQuestionVersionForCardAction(
      text(args["questionId"]),
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "done" || state.version === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: {
        questionId: text(args["questionId"]),
        version: state.version,
        status: text(state.versionStatus, "draft"),
      },
    };
  },
};

const RUNNERS: Readonly<Record<string, StepRunner>> = {
  "apply-draft": applyDraftRunner,
  ...QUESTION_RUNNERS,
  "form.create": async ({ tokenStep, args, agentProposal }) => {
    const state = await createFormForCardAction(
      {
        slug: text(args["slug"]),
        defaultLocale: text(args["defaultLocale"]),
        ...(typeof args["workspaceId"] === "string" ? { workspaceId: args["workspaceId"] } : {}),
      },
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "created" || state.formId === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return { outcome: "done", result: { formId: state.formId, slug: text(state.slug) } };
  },
  /* The form id may be the create step's own result, and the definition the card bound carries no
     formId, so the save puts the resolved one back. */
  "form.saveDraft": async ({ tokenStep, args, agentProposal }) => {
    const formId = text(args["formId"]);
    const definition = args["definition"];
    if (formId === "" || typeof definition !== "object" || definition === null) {
      return { outcome: "failed", message: t("agent.card.note.unresolvedReference") };
    }
    const draft = { ...(definition as Record<string, unknown>), formId } as unknown as DraftForm;
    const state = await saveFormDraftAction(
      formId,
      draft,
      true,
      undefined,
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "saved") return { outcome: "failed", message: text(state.message) };
    return {
      outcome: "done",
      result: {
        formId,
        steps: countOf(definition, "steps"),
        questions: pinnedCount(definition),
        rules: countOf(definition, "rules"),
      },
    };
  },
  "form.publish": publishStep,
  "form.settings": async ({ tokenStep, args, agentProposal }) => {
    const state = await updateSettingsAction(
      text(args["formId"]),
      {
        ...(typeof args["challengeRequired"] === "boolean"
          ? { challengeRequired: args["challengeRequired"] }
          : {}),
        ...(typeof args["minSubmitMs"] === "number" || args["minSubmitMs"] === null
          ? { minSubmitMs: args["minSubmitMs"] }
          : {}),
      },
      proposalRef(agentProposal, tokenStep),
    );
    const settings = state.settings;
    if (state.status !== "saved" || settings === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: {
        challengeRequired: settings.challengeRequired,
        ...(typeof settings.minSubmitMs === "number" ? { minSubmitMs: settings.minSubmitMs } : {}),
        challengeEnforceable: state.challengeEnforceable === true,
      },
    };
  },
  "form.close": intakeRunner("close"),
  "form.reopen": intakeRunner("reopen"),
  "form.release": async ({ step, tokenStep, args, agentProposal, currentEnvironment }) => {
    const version = whole(args["version"]);
    if (version === undefined) {
      return { outcome: "failed", message: t("agent.card.note.unresolvedReference") };
    }
    const state = await releaseVersionAction(
      text(args["formId"]),
      currentEnvironment,
      {
        version,
        environment: step.environment,
        ...(typeof args["fromEnvironment"] === "string"
          ? { fromEnvironment: args["fromEnvironment"] }
          : {}),
      },
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "released" || state.version === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: { version: state.version, environment: state.environment ?? step.environment },
    };
  },
  "response.erase": async ({ step, tokenStep, args, agentProposal }) => {
    const reason = text(args["reason"]);
    if (!isErasureReason(reason)) {
      return { outcome: "failed", message: t("ops.error.invalidErasureReason") };
    }
    const state = await eraseSessionAction(
      text(args["formId"]),
      step.environment,
      text(args["sessionId"]),
      reason,
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "erased" || state.data === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: {
        sessionId: state.data.sessionId,
        environment: step.environment,
        alreadyErased: state.data.alreadyErased,
      },
    };
  },
  "response.unflag": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await unflagResponseAction(
      text(args["formId"]),
      step.environment,
      text(args["sessionId"]),
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "unflagged") {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: {
        sessionId: text(args["sessionId"]),
        environment: step.environment,
        released: state.released === true,
      },
    };
  },
  "webhook.create": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await createWebhookAction(
      text(args["formId"]),
      step.environment,
      { url: text(args["url"]), active: args["active"] === true },
      proposalRef(agentProposal, tokenStep),
    );
    return endpointOutcome(state, step, text(state.revealed?.webhookId));
  },
  "webhook.rotate": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await rotateSecretAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      proposalRef(agentProposal, tokenStep),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.retarget": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await retargetWebhookAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      text(args["url"]),
      proposalRef(agentProposal, tokenStep),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.reactivate": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await reactivateWebhookAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      proposalRef(agentProposal, tokenStep),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.deactivate": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await deactivateWebhookAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      proposalRef(agentProposal, tokenStep),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.redeliver": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await redeliverAction(
      step.environment,
      text(args["formId"]),
      text(args["deliveryId"]),
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "done") {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: {
        deliveryId: text(args["deliveryId"]),
        environment: step.environment,
        queued: state.queued ?? 0,
      },
    };
  },
  "link.mint": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await mintLinksAction(
      text(args["formId"]),
      step.environment,
      {
        expiresAt: text(args["expiresAt"]),
        oneTime: args["oneTime"] === true,
        count: count(args["count"]),
      },
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "minted") {
      return { outcome: "failed", message: text(state.message) };
    }
    const links = state.links ?? [];
    return {
      outcome: "done",
      result: {
        count: links.length,
        expiresAt: text(links[0]?.expiresAt),
        environment: step.environment,
      },
    };
  },
  ...MEMBERSHIP_RUNNERS,
  "link.revoke": async ({ step, tokenStep, args, agentProposal }) => {
    const state = await revokeLinkAction(
      text(args["formId"]),
      step.environment,
      text(args["linkId"]),
      proposalRef(agentProposal, tokenStep),
    );
    if (state.status !== "revoked") {
      return { outcome: "failed", message: text(state.message) };
    }
    return { outcome: "done", result: { linkId: state.linkId, environment: step.environment } };
  },
};

export const RUNNABLE_ACTION_KINDS: readonly string[] = Object.keys(RUNNERS);

export function isRunnableKind(kind: string): boolean {
  return Object.hasOwn(RUNNERS, kind);
}

export const runStepAction: StepRunner = async (request) => {
  const runner = RUNNERS[request.step.kind];
  if (runner === undefined) {
    return { outcome: "failed", message: t("agent.card.note.notWired") };
  }
  return runner(request);
};
