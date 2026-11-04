"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import { AssistMarkdown } from "@/components/forms/assist-markdown";
import { Button } from "@/components/kit";
import { nextDraftSaved, type BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import {
  isProseTurn,
  promptTurns,
  type AgentTurnRecord,
  type ConversationHandle,
} from "@/lib/agent/conversation";
import type { ResolvedScreen } from "@/lib/agent/screens";
import {
  actionResultTurn,
  cancelCard,
  expireCard,
  firstPendingStep,
  initialCard,
  requestStop,
  showsMarker,
  startRun,
  type AgentCardView,
} from "@/lib/agent/plan-state";
import {
  monotonicNow,
  remainingWindowMs,
  startedWindow,
  useExpiryTick,
  type ProposalWindow,
} from "@/lib/agent/proposal-window";
import { runPlan } from "@/lib/agent/runner";
import { stepTitle } from "@/lib/agent/card-copy";
import { useProposalSeam } from "@/lib/agent/waiting";
import { errorForResponse, messageForError, type AssistError } from "@/lib/forms/assist-errors";
import { readAssistEvents, type AgentProposal, type AssistEvent } from "@/lib/forms/assist-stream";

import { ActionCard } from "./action-card";
import { runStepAction } from "./step-actions";

const MAX_REASON = 280;

function handOffFields(args: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === "string") fields[name] = value;
    else if (typeof value === "number" || typeof value === "boolean") fields[name] = String(value);
  }
  return fields;
}

function continuesAfterAccept(plan: AgentProposal): boolean {
  return plan.steps.some((step) => step.kind === "apply-draft");
}

function ranCleanly(settled: AgentCardView): boolean {
  return settled.steps.length > 0 && settled.steps.every((step) => step.state === "done");
}

import {
  applyTurnEvent,
  EMPTY_TURN,
  finishTurn,
  lastTextSegment,
  runningStep,
  turnText,
  type AssistantTurnView,
  type StepState,
  type TurnSegment,
  type TurnStep,
} from "@/lib/forms/assist-turn";
import { t, type MessageKey } from "@/lib/i18n/en";

/* Send screen and route identifiers, never context contents; the API computes accessible context under the
   caller's grants. */
export function AssistantConversation({
  screen,
  conversation,
  builder,
  composerRef,
  onWorkingChange,
  onAnnounce,
}: {
  readonly screen: ResolvedScreen | undefined;
  readonly conversation: ConversationHandle;
  readonly builder: BuilderAssistSnapshot | undefined;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onWorkingChange: (working: boolean) => void;
  readonly onAnnounce: (message: string) => void;
}) {
  const writable = builder !== undefined && builder.canPropose ? builder : undefined;
  return (
    <ScreenConversation
      key={writable === undefined ? "screen" : "builder"}
      screen={screen}
      conversation={conversation}
      builder={writable}
      composerRef={composerRef}
      onWorkingChange={onWorkingChange}
      onAnnounce={onAnnounce}
    />
  );
}

function ScreenConversation({
  screen,
  conversation,
  builder,
  composerRef,
  onWorkingChange,
  onAnnounce,
}: {
  readonly screen: ResolvedScreen | undefined;
  readonly conversation: ConversationHandle;
  readonly builder: BuilderAssistSnapshot | undefined;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onWorkingChange: (working: boolean) => void;
  readonly onAnnounce: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [shown, setShown] = useState<readonly ShownTurn[]>(() => restored(conversation.turns));
  const [live, setLive] = useState<AssistantTurnView | undefined>(undefined);
  const [failure, setFailure] = useState<AssistError | undefined>(undefined);
  const [proposal, setProposal] = useState<AgentProposal | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [card, setCard] = useState<AgentCardView | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const windowRef = useRef<ProposalWindow>({ startedAt: 0, totalMs: 0 });
  const seam = useProposalSeam();
  const publish = seam?.publish;
  const requestHandOff = seam?.requestHandOff;
  const cardId = useId();

  useEffect(() => {
    if (publish === undefined) return;
    if (proposal === undefined || card === undefined || !showsMarker(card)) {
      publish(undefined);
      return;
    }
    const step = proposal.steps[firstPendingStep(card) ?? 0];
    if (step === undefined) {
      publish(undefined);
      return;
    }
    const control = step.card.headingControl;
    publish({
      cardId,
      summary: stepTitle(step, {}),
      ...(control === undefined ? {} : { control }),
    });
  }, [card, cardId, proposal, publish]);

  const onExpire = useCallback(() => {
    setCard((current) => (current === undefined ? current : expireCard(current)));
  }, []);
  useExpiryTick(windowRef.current, card?.state === "proposed", onExpire);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const settle = (plan: AgentProposal, settled: AgentCardView): void => {
    setCard(settled);
    const turn = actionResultTurn(plan, settled);
    if (turn !== undefined) conversation.append([turn]);
  };

  const confirmCard = async (plan: AgentProposal, from: AgentCardView): Promise<void> => {
    // Subscribe before running: the accept's own save is the event being awaited.
    const saved = continuesAfterAccept(plan) ? nextDraftSaved() : undefined;
    const started = startRun(from);
    setCard(started);
    const settled = await runPlan({
      proposal: plan,
      card: started,
      runStep: runStepAction,
      onChange: setCard,
      onHandOff: (step, _index, args) => {
        const control = step.card.headingControl;
        if (control === undefined || requestHandOff === undefined) return;
        requestHandOff(control, handOffFields(args));
      },
      now: () => new Date(),
      windowLeftMs: () => remainingWindowMs(windowRef.current, monotonicNow()),
    });
    settle(plan, settled);
    if (saved === undefined || !ranCleanly(settled)) return;
    const token = await saved;
    if (token !== undefined) await runTurn(undefined, token);
  };

  const postTurn = (
    on: ResolvedScreen,
    signal: AbortSignal,
    savedDraft?: string,
  ): Promise<Response> => {
    const draftUpdatedAt = savedDraft ?? builder?.draftUpdatedAt;
    return fetch(builder?.endpoint ?? "/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        conversation: promptTurns(conversation.current()),
        screen: on.screen,
        params: on.params,
        conversationId: conversation.id,
        ...(draftUpdatedAt === undefined ? {} : { clientState: draftUpdatedAt }),
      }),
    });
  };

  const absorb = (event: AssistEvent): void => {
    if (event.type === "action" || event.type === "plan") {
      setProposal(event.proposal);
      windowRef.current = startedWindow(event.proposal);
      setCard(initialCard(event.proposal));
      onAnnounce(t("agent.launcher.toReview"));
      return;
    }
    if (event.type === "tool-rejected") setFailure({ kind: "TOOL_REJECTED", tool: event.tool });
    if (event.type === "error") setFailure({ kind: event.code, message: event.message });
  };

  const runTurn = async (message: string | undefined, savedDraft?: string): Promise<void> => {
    if (screen === undefined || live !== undefined) return;
    setFailure(undefined);
    if (message !== undefined) {
      setShown((current) => [...current, { role: "user", content: message }]);
      conversation.append([{ role: "user", content: message }]);
    }
    let turn = EMPTY_TURN;
    setLive(turn);
    onWorkingChange(true);
    onAnnounce(t("agent.announce.working"));
    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;

    try {
      const response = await postTurn(screen, controller.signal, savedDraft);
      if (!response.ok || response.body === null) {
        const failed = await errorForResponse(response);
        setFailure(failed);
        onAnnounce(messageForError(failed));
        return;
      }
      for await (const event of readAssistEvents(response.body)) {
        turn = applyTurnEvent(turn, event);
        setLive(turn);
        absorb(event);
        const step = runningStep(turn);
        if (step !== undefined) onAnnounce(t(step.label));
      }
      const ended = finishTurn(turn);
      if (ended.segments.length > 0) {
        setShown((current) => [...current, { role: "assistant", view: ended }]);
      }
      const text = turnText(ended).trim();
      if (text !== "") conversation.append([{ role: "assistant", content: text }]);
      setReason(lastTextSegment(ended).trim().slice(0, MAX_REASON));
      onAnnounce(stoppedRef.current ? t("agent.announce.stopped") : t("agent.announce.done"));
    } catch {
      if (!stoppedRef.current) {
        setFailure((current) => current ?? { kind: "PROVIDER_ERROR" });
        onAnnounce(t("agent.announce.failed"));
      }
    } finally {
      abortRef.current = null;
      setLive(undefined);
      onWorkingChange(false);
    }
  };

  const send = async (): Promise<void> => {
    const message = value.trim();
    if (message === "" || screen === undefined || live !== undefined) return;
    setValue("");
    await runTurn(message);
  };

  return (
    <div className="qcms-assistant__conversation">
      {/* Make the scrolling conversation focusable; prose-only turns otherwise offer no keyboard entry to its
   scroll region. */}
      <ol
        className="qcms-assistant__turns"
        data-testid="qcms-assistant-turns"
        tabIndex={0}
        aria-label={t("agent.conversationLabel")}
      >
        {shown.map((turn, index) =>
          turn.role === "user" ? (
            <li key={`user-${String(index)}`} className="qcms-assistant__turn" data-role="user">
              <AssistMarkdown text={turn.content} />
            </li>
          ) : (
            <li
              key={`assistant-${String(index)}`}
              className="qcms-assistant__turn"
              data-role="assistant"
            >
              <AssistMark size={20} />
              <div className="qcms-assistant__segments">
                {turn.view.segments.map((segment, at) => (
                  <Segment key={`${segment.kind}:${String(at)}`} segment={segment} />
                ))}
              </div>
            </li>
          ),
        )}
        {live !== undefined && (
          <li
            className="qcms-assistant__turn"
            data-role="assistant"
            data-testid="qcms-assistant-streaming"
            aria-busy="true"
          >
            <AssistMark size={20} working />
            <div className="qcms-assistant__segments">
              {live.segments.length === 0 ? (
                <p>
                  {t("forms.assist.working")}
                  <span className="qcms-assist-caret" aria-hidden="true" />
                </p>
              ) : (
                live.segments.map((segment, at) => (
                  <Segment
                    key={`${segment.kind}:${String(at)}`}
                    segment={segment}
                    trailing={
                      at === live.segments.length - 1 ? (
                        <span className="qcms-assist-caret" aria-hidden="true" />
                      ) : undefined
                    }
                  />
                ))
              )}
            </div>
          </li>
        )}
        {proposal !== undefined && card !== undefined && (
          <li className="qcms-assistant__turn" data-role="assistant">
            <ActionCard
              id={cardId}
              proposal={proposal}
              card={card}
              reason={reason}
              remainingMs={remainingWindowMs(windowRef.current, monotonicNow())}
              onConfirm={() => void confirmCard(proposal, card)}
              onCancel={() => settle(proposal, cancelCard(card, new Date().toISOString()))}
              onStop={() => setCard(requestStop(card))}
            />
          </li>
        )}
      </ol>
      {shown.length === 0 && live === undefined && (
        <p className="qcms-assistant__empty" data-testid="qcms-assistant-empty">
          {t("agent.empty")}
        </p>
      )}
      {failure !== undefined && (
        <p className="qcms-assistant__error" data-testid="qcms-assistant-error">
          {messageForError(failure)}
        </p>
      )}
      <div className="qcms-assistant__composer">
        <label className="qcms-visually-hidden" htmlFor="qcms-assistant-composer">
          {t("agent.composer")}
        </label>
        <textarea
          id="qcms-assistant-composer"
          ref={composerRef}
          rows={3}
          value={value}
          data-testid="qcms-assistant-composer"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void send();
          }}
        />
        {live === undefined ? (
          <span data-testid="qcms-assistant-send">
            <Button
              onPress={() => {
                void send();
              }}
              isDisabled={value.trim() === "" || screen === undefined}
            >
              {t("agent.send")}
            </Button>
          </span>
        ) : (
          <span data-testid="qcms-assistant-stop">
            <Button
              onPress={() => {
                stoppedRef.current = true;
                abortRef.current?.abort();
              }}
            >
              {t("agent.stop")}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

function Segment({
  segment,
  trailing,
}: {
  readonly segment: TurnSegment;
  readonly trailing?: ReactNode;
}) {
  if (segment.kind === "text") return <AssistMarkdown text={segment.text} trailing={trailing} />;
  if (segment.kind === "thinking") return <Thinking segment={segment} />;
  return <StepTimeline steps={segment.steps} />;
}

function Thinking({ segment }: { readonly segment: Extract<TurnSegment, { kind: "thinking" }> }) {
  const running = segment.endedAt === undefined;
  const seconds = running
    ? undefined
    : Math.max(1, Math.round((segment.endedAt - segment.startedAt) / 1000));
  return (
    <details className="qcms-assist-think" data-testid="qcms-assistant-thinking">
      <summary>
        <span>{t("forms.assist.thinking")}</span>
        {running ? (
          <span className="qcms-assist-think__pulse" aria-hidden="true" />
        ) : (
          <span className="qcms-assist-think__took">
            {t("forms.assist.thoughtFor", { seconds: String(seconds) })}
          </span>
        )}
      </summary>
      <p className="qcms-assist-think__body">{segment.text}</p>
    </details>
  );
}

const STEP_STATE_LABELS: Readonly<Record<StepState, MessageKey>> = {
  running: "forms.assist.stepRunning",
  done: "forms.assist.stepDone",
  failed: "forms.assist.stepFailed",
  interrupted: "forms.assist.stepInterrupted",
};

function StepIcon({ state }: { readonly state: StepState }) {
  if (state === "running") return <span className="qcms-assist-steps__pulse" />;
  const path = {
    done: "M20 6 9 17l-5-5",
    failed: "M18 6 6 18M6 6l12 12",
    interrupted: "M5 12h14",
  }[state];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepTimeline({ steps }: { readonly steps: readonly TurnStep[] }) {
  return (
    <ol
      className="qcms-assist-steps"
      aria-label={t("forms.assist.stepsLabel")}
      data-testid="qcms-assistant-steps"
    >
      {steps.map((step, at) => {
        const problem = step.state === "failed" || step.state === "interrupted";
        return (
          <li key={`${step.label}:${String(at)}`} data-state={step.state}>
            <span className="qcms-assist-steps__icon" aria-hidden="true">
              <StepIcon state={step.state} />
            </span>
            <span>{t(step.label)}</span>
            <span className="qcms-visually-hidden">, </span>
            <span className={problem ? "qcms-assist-steps__state" : "qcms-visually-hidden"}>
              {t(STEP_STATE_LABELS[step.state])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type ShownTurn =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly view: AssistantTurnView };

function restored(turns: readonly AgentTurnRecord[]): readonly ShownTurn[] {
  return turns.flatMap((turn): readonly ShownTurn[] => {
    if (!isProseTurn(turn) || turn.role === "result") return [];
    if (turn.role === "user") return [{ role: "user", content: turn.content }];
    return [
      {
        role: "assistant",
        view: finishTurn(applyTurnEvent(EMPTY_TURN, { type: "text", delta: turn.content })),
      },
    ];
  });
}
