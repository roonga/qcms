"use client";

import {
  confirmPublishAction,
  mintLinksAction,
  releaseVersionAction,
  reviewReleaseAction,
  revokeLinkAction,
  setFormStatusAction,
  updateSettingsAction,
} from "@/app/(shell)/forms/actions";
import { eraseSessionAction, unflagResponseAction } from "@/app/(shell)/responses/actions";
import {
  createWebhookAction,
  deactivateWebhookAction,
  reactivateWebhookAction,
  redeliverAction,
  retargetWebhookAction,
  rotateSecretAction,
} from "@/app/(shell)/webhooks/actions";
import { isErasureReason } from "@/lib/ops/erasure";
import type { WebhookActionState } from "@/components/ops/webhook-config";
import type { AgentStepResult } from "@/lib/agent/plan-state";
import type { AgentPlanStep } from "@/lib/forms/assist-stream";
import type { RunStepRequest } from "@/lib/agent/runner";
import { t } from "@/lib/i18n/en";

/**
 * One step's screen action: each kind runs through that screen's own exported server
 * action rather than a generic endpoint, so it keeps the session gate, origin check,
 * route, authorisation and revalidation a human press has (R2). A kind with no entry
 * here is not runnable from a card and reports a failure rather than doing nothing.
 */

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" ? value : Number.parseInt(text(value, "1"), 10) || 1;
}

/** A whole number, or nothing: a resolved reference arrives as the value its step reported. */
function whole(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

type StepRunner = (request: RunStepRequest) => Promise<AgentStepResult>;

function proposalRef(
  agentProposal: string | undefined,
  index: number,
): { agentProposal: string; step: number } | undefined {
  return agentProposal === undefined ? undefined : { agentProposal, step: index };
}

/** Close and reopen are one screen control and one route pair, so they share a runner. */
function intakeRunner(action: "close" | "reopen"): StepRunner {
  return async ({ step, index, args, agentProposal }) => {
    const state = await setFormStatusAction(
      text(args["formId"]),
      step.environment,
      action,
      proposalRef(agentProposal, index),
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

/**
 * One endpoint change's answer. The two-person rule makes `pending` a third outcome rather
 * than an error: the change is stored, the endpoint is as it was, and the plan ends there
 * with the screen's own sentence about who confirms it.
 */
function endpointOutcome(
  state: WebhookActionState,
  step: AgentPlanStep,
  webhookId: string,
): AgentStepResult {
  if (state.status === "error") {
    return { outcome: "failed", message: text(state.message) };
  }
  // The secret exists in plaintext here and on the card, and nowhere else (SEC-6).
  const revealed = state.revealed?.secret;
  const result = { webhookId, environment: step.environment };
  if (state.status === "pending") {
    return {
      outcome: "pending-approval",
      // The screen's own sentence about who confirms it, word for word.
      message: t("ops.proposals.stored", { environment: step.environment }),
      result,
      ...(revealed === undefined ? {} : { revealed }),
    };
  }
  return { outcome: "done", result, ...(revealed === undefined ? {} : { revealed }) };
}

/**
 * Publishing runs the wizard's own confirmation, so the card inherits its stale-review and
 * workflow-revision checks: the review is read here, immediately before Confirm, and its
 * two expectations travel with the request. A draft saved in between is refused and
 * nothing is written, exactly as it is for the wizard.
 */
const publishStep: StepRunner = async ({ step, index, args, agentProposal }) => {
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
    proposalRef(agentProposal, index),
  );
  if (state.status !== "done" || state.version === undefined) {
    return { outcome: "failed", message: text(state.message) };
  }
  return {
    outcome: "done",
    result: { version: state.version, environment: step.environment },
  };
};

const RUNNERS: Readonly<Record<string, StepRunner>> = {
  "form.publish": publishStep,
  "form.settings": async ({ index, args, agentProposal }) => {
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
      proposalRef(agentProposal, index),
    );
    const settings = state.settings;
    if (state.status !== "saved" || settings === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      // `minSubmitMs: null` is the deployment's own floor, so it is reported as absent
      // rather than as a number nobody set.
      result: {
        challengeRequired: settings.challengeRequired,
        ...(typeof settings.minSubmitMs === "number" ? { minSubmitMs: settings.minSubmitMs } : {}),
        challengeEnforceable: state.challengeEnforceable === true,
      },
    };
  },
  "form.close": intakeRunner("close"),
  "form.reopen": intakeRunner("reopen"),
  "form.release": async ({ step, index, args, agentProposal, currentEnvironment }) => {
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
      proposalRef(agentProposal, index),
    );
    if (state.status !== "released" || state.version === undefined) {
      return { outcome: "failed", message: text(state.message) };
    }
    return {
      outcome: "done",
      result: { version: state.version, environment: state.environment ?? step.environment },
    };
  },
  "response.erase": async ({ step, index, args, agentProposal }) => {
    const reason = text(args["reason"]);
    // Refused rather than defaulted: the reason is written onto a tombstone, and the
    // digest binds the one the card displayed.
    if (!isErasureReason(reason)) {
      return { outcome: "failed", message: t("ops.error.invalidErasureReason") };
    }
    const state = await eraseSessionAction(
      text(args["formId"]),
      step.environment,
      text(args["sessionId"]),
      reason,
      proposalRef(agentProposal, index),
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
  "response.unflag": async ({ step, index, args, agentProposal }) => {
    const state = await unflagResponseAction(
      text(args["formId"]),
      step.environment,
      text(args["sessionId"]),
      proposalRef(agentProposal, index),
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
  "webhook.create": async ({ step, index, args, agentProposal }) => {
    const state = await createWebhookAction(
      text(args["formId"]),
      step.environment,
      { url: text(args["url"]), active: args["active"] === true },
      proposalRef(agentProposal, index),
    );
    return endpointOutcome(state, step, text(state.revealed?.webhookId));
  },
  "webhook.rotate": async ({ step, index, args, agentProposal }) => {
    const state = await rotateSecretAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      proposalRef(agentProposal, index),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.retarget": async ({ step, index, args, agentProposal }) => {
    const state = await retargetWebhookAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      text(args["url"]),
      proposalRef(agentProposal, index),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.reactivate": async ({ step, index, args, agentProposal }) => {
    const state = await reactivateWebhookAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      proposalRef(agentProposal, index),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.deactivate": async ({ step, index, args, agentProposal }) => {
    const state = await deactivateWebhookAction(
      text(args["formId"]),
      step.environment,
      text(args["webhookId"]),
      proposalRef(agentProposal, index),
    );
    return endpointOutcome(state, step, text(args["webhookId"]));
  },
  "webhook.redeliver": async ({ step, index, args, agentProposal }) => {
    const state = await redeliverAction(
      step.environment,
      text(args["formId"]),
      text(args["deliveryId"]),
      proposalRef(agentProposal, index),
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
  "link.mint": async ({ step, index, args, agentProposal }) => {
    const state = await mintLinksAction(
      text(args["formId"]),
      step.environment,
      {
        expiresAt: text(args["expiresAt"]),
        oneTime: args["oneTime"] === true,
        count: count(args["count"]),
      },
      proposalRef(agentProposal, index),
    );
    if (state.status !== "minted") {
      return { outcome: "failed", message: text(state.message) };
    }
    // The URLs reach the screen and stop there: `link.mint` allowlists the count, the
    // expiry and the environment, and the card filters the rest out (SEC-8, section 7.6).
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
  "link.revoke": async ({ step, index, args, agentProposal }) => {
    const state = await revokeLinkAction(
      text(args["formId"]),
      step.environment,
      text(args["linkId"]),
      proposalRef(agentProposal, index),
    );
    if (state.status !== "revoked") {
      return { outcome: "failed", message: text(state.message) };
    }
    return { outcome: "done", result: { linkId: state.linkId, environment: step.environment } };
  },
};

/** The kinds a card can run today. The rest arrive with their screen group. */
export const RUNNABLE_ACTION_KINDS: readonly string[] = Object.keys(RUNNERS);

export function isRunnableKind(kind: string): boolean {
  return Object.hasOwn(RUNNERS, kind);
}

export const runStepAction: StepRunner = async (request) => {
  const runner = RUNNERS[request.step.kind];
  if (runner === undefined) {
    // Said rather than left blank: a step that quietly did nothing is the worst report.
    return { outcome: "failed", message: t("agent.card.note.notWired") };
  }
  return runner(request);
};
