"use client";

import {
  mintLinksAction,
  revokeLinkAction,
  setFormStatusAction,
  updateSettingsAction,
} from "@/app/(shell)/forms/actions";
import type { AgentStepResult } from "@/lib/agent/plan-state";
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

const RUNNERS: Readonly<Record<string, StepRunner>> = {
  "form.settings": async ({ index, args, agentProposal }) => {
    const state = await updateSettingsAction(
      text(args["formId"]),
      {
        ...(typeof args["challengeRequired"] === "boolean"
          ? { challengeRequired: args["challengeRequired"] }
          : {}),
        ...(typeof args["minSubmitMs"] === "number" || args["minSubmitMs"] === null
          ? { minSubmitMs: args["minSubmitMs"] as number | null }
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
        ...(typeof settings.minSubmitMs === "number"
          ? { minSubmitMs: settings.minSubmitMs }
          : {}),
        challengeEnforceable: state.challengeEnforceable === true,
      },
    };
  },
  "form.close": intakeRunner("close"),
  "form.reopen": intakeRunner("reopen"),
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
