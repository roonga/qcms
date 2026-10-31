"use client";

import { mintLinksAction, revokeLinkAction } from "@/app/(shell)/forms/actions";
import type { AgentStepResult } from "@/lib/agent/plan-state";
import type { RunStepRequest } from "@/lib/agent/runner";
import { t } from "@/lib/i18n/en";

/**
 * One step's screen action (083 D0, section 6.4).
 *
 * Confirm calls **that step's screen's own exported server action**, imported here, with
 * the step's arguments and one trailing `{ agentProposal, step }` the action forwards as
 * the two headers. No step is dispatched through a generic endpoint and there is no
 * server-side executor, which is what keeps each step on the same session gate, origin
 * check, route, authorisation and revalidation as the control a human presses (R2).
 *
 * A kind with no entry here is not runnable from a card. The grant filter and the propose
 * tool would not have offered it, and the API would refuse it at its own route; this map
 * is the third place that has to agree, so an unmapped kind reports a failure rather than
 * silently doing nothing.
 *
 * `form.publish` and `form.release` are deliberately absent: environment phase 5 replaces
 * the publish and release screens and deletes the actions a card would import, so their
 * wiring belongs to D1 and D2, after that lands. Their descriptors are on the branch
 * because D0's own criteria need a kind whose environment comes from its arguments.
 */

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" ? value : Number.parseInt(text(value, "1"), 10) || 1;
}

type StepRunner = (request: RunStepRequest) => Promise<AgentStepResult>;

const RUNNERS: Readonly<Record<string, StepRunner>> = {
  "link.mint": async ({ step, index, args, agentProposal }) => {
    const state = await mintLinksAction(
      text(args["formId"]),
      step.environment,
      {
        expiresAt: text(args["expiresAt"]),
        oneTime: args["oneTime"] === true,
        count: count(args["count"]),
      },
      agentProposal === undefined ? undefined : { agentProposal, step: index },
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
      agentProposal === undefined ? undefined : { agentProposal, step: index },
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
