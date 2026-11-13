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
import { REASON_CHARS } from "@/lib/agent/reason";
import { Button } from "@/components/kit";
import { nextDraftSaved, type BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import {
  CONVERSATION_TURN_CAP,
  isProseTurn,
  promptTurns,
  waitingProposalTurns,
  type AgentTurnRecord,
  type ConversationHandle,
  type WaitingProposalTurn,
} from "@/lib/agent/conversation";
import { screenIdentity, type ResolvedScreen } from "@/lib/agent/screens";
import {
  actionResultTurn,
  cancelCard,
  dismissReveal,
  expireCard,
  firstPendingStep,
  holdsReveal,
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
import { displayText, planNames, stepTitle } from "@/lib/agent/card-copy";
import { useProposalSeam } from "@/lib/agent/waiting";
import { errorForResponse, messageForError, type AssistError } from "@/lib/forms/assist-errors";
import { readAssistEvents, type AgentProposal, type AssistEvent } from "@/lib/forms/assist-stream";

import { ActionCard } from "./action-card";
import { runStepAction } from "./step-actions";

/* Room for the card's own flattener to cut on a word boundary: a hard cut here would strand a
   half word no later pass could repair. The card quotes REASON_CHARS of what this keeps. */
const REASON_SOURCE_CHARS = 4 * REASON_CHARS;

/* The builder holds the open draft's title, so a card about that form can name it. */
function builderNames(
  builder: BuilderAssistSnapshot | undefined,
): ReadonlyMap<string, string> | undefined {
  const draft = builder?.draft;
  const title = draft === undefined ? undefined : displayText(draft.title);
  return draft === undefined || title === undefined ? undefined : new Map([[draft.formId, title]]);
}

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

interface OneCard {
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
}

/* `held` are settled cards kept on screen for a reveal alone, because a one-time value the next
   proposal swept away could not be shown again. */
interface CardsView {
  readonly open: OneCard | undefined;
  readonly held: readonly OneCard[];
}

const NO_CARDS: CardsView = { open: undefined, held: [] };

function noop(): void {
  return undefined;
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
  environment,
  conversation,
  builder,
  composerRef,
  onWorkingChange,
  onAnnounce,
}: {
  readonly screen: ResolvedScreen | undefined;
  readonly environment: string;
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
      environment={environment}
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
  environment,
  conversation,
  builder,
  composerRef,
  onWorkingChange,
  onAnnounce,
}: {
  readonly screen: ResolvedScreen | undefined;
  readonly environment: string;
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
  const [reason, setReason] = useState("");
  const [cards, setCards] = useState<CardsView>(NO_CARDS);
  const proposal = cards.open?.proposal;
  const card = cards.open?.card;
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
      summary: stepTitle(step, {}, proposal.steps, planNames(proposal)),
      ...(control === undefined ? {} : { control }),
    });
  }, [card, cardId, proposal, publish]);

  const showCard = useCallback((next: AgentCardView) => {
    setCards((current) =>
      current.open === undefined ? current : { ...current, open: { ...current.open, card: next } },
    );
  }, []);

  const dismissOpenReveal = useCallback((index: number) => {
    setCards((current) =>
      current.open === undefined
        ? current
        : { ...current, open: { ...current.open, card: dismissReveal(current.open.card, index) } },
    );
  }, []);

  const dismissHeldReveal = useCallback((proposalId: string, index: number) => {
    setCards((current) => ({
      ...current,
      held: current.held
        .map((entry) =>
          entry.proposal.proposalId === proposalId
            ? { ...entry, card: dismissReveal(entry.card, index) }
            : entry,
        )
        .filter((entry) => holdsReveal(entry.card)),
    }));
  }, []);

  const onExpire = useCallback(() => {
    setCards((current) =>
      current.open === undefined
        ? current
        : { ...current, open: { ...current.open, card: expireCard(current.open.card) } },
    );
  }, []);
  const waiting = card?.state === "proposed";
  useExpiryTick(windowRef.current, waiting, onExpire);

  const where = screenIdentity(screen);
  const boundTo = useRef<{ readonly where: string; readonly environment: string } | undefined>(
    undefined,
  );

  // A card is an act on one screen in one environment, and the server binds its token to
  // both, so leaving either is a Confirm the user can no longer mean.
  useEffect(() => {
    const origin = boundTo.current;
    if (!waiting || origin === undefined) return;
    if (origin.where === where && origin.environment === environment) return;
    boundTo.current = undefined;
    onExpire();
    onAnnounce(t("agent.announce.cardExpired"));
  }, [environment, onAnnounce, onExpire, waiting, where]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const settle = (plan: AgentProposal, settled: AgentCardView): void => {
    showCard(settled);
    const turn = actionResultTurn(plan, settled);
    if (turn !== undefined) conversation.append([turn]);
  };

  const confirmCard = async (plan: AgentProposal, from: AgentCardView): Promise<void> => {
    // Subscribe before running: the accept's own save is the event being awaited.
    const saved = continuesAfterAccept(plan) ? nextDraftSaved() : undefined;
    const started = startRun(from);
    showCard(started);
    const settled = await runPlan({
      proposal: plan,
      card: started,
      runStep: runStepAction,
      onChange: showCard,
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
    if (token !== undefined) await runTurn(undefined, token, []);
  };

  const postTurn = (
    on: ResolvedScreen,
    signal: AbortSignal,
    savedDraft: string | undefined,
    waitingCard: readonly WaitingProposalTurn[],
  ): Promise<Response> => {
    const draftUpdatedAt = savedDraft ?? builder?.draftUpdatedAt;
    return fetch(builder?.endpoint ?? "/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        conversation: [...promptTurns(conversation.current()), ...waitingCard],
        screen: on.screen,
        params: on.params,
        conversationId: conversation.id,
        visitId: conversation.visitId,
        ...(draftUpdatedAt === undefined ? {} : { clientState: draftUpdatedAt }),
      }),
    });
  };

  const absorb = (event: AssistEvent): void => {
    if (event.type === "action" || event.type === "plan") {
      const arriving = event.proposal;
      windowRef.current = startedWindow(arriving);
      boundTo.current = { where, environment };
      // A reveal cannot be produced again, so the card holding one stays until the person says otherwise.
      setCards((current) => ({
        held:
          current.open !== undefined && holdsReveal(current.open.card)
            ? [...current.held, current.open]
            : current.held,
        open: { proposal: arriving, card: initialCard(arriving) },
      }));
      onAnnounce(t("agent.launcher.toReview"));
      return;
    }
    if (event.type === "tool-rejected") setFailure({ kind: "TOOL_REJECTED", tool: event.tool });
    if (event.type === "error") setFailure({ kind: event.code, message: event.message });
  };

  const runTurn = async (
    message: string | undefined,
    savedDraft: string | undefined,
    waitingCard: readonly WaitingProposalTurn[],
  ): Promise<void> => {
    if (screen === undefined || live !== undefined) return;
    setFailure(undefined);
    if (message !== undefined) {
      setShown((current) => capped([...current, { role: "user", content: message }]));
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
      const response = await postTurn(screen, controller.signal, savedDraft, waitingCard);
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
        setShown((current) => capped([...current, { role: "assistant", view: ended }]));
      }
      const text = turnText(ended).trim();
      if (text !== "") conversation.append([{ role: "assistant", content: text }]);
      setReason(lastTextSegment(ended).trim().slice(0, REASON_SOURCE_CHARS));
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
    // Read here rather than in the post: only the browser knows a card is still on screen,
    // and a model that is not told reads a conversation in which it proposed nothing.
    await runTurn(message, undefined, waitingProposalTurns(waiting ? proposal : undefined));
  };

  return (
    <div className="qcms-assistant__conversation">
      {conversation.dropped > 0 && (
        <p className="qcms-assistant__note" data-testid="qcms-assistant-trimmed">
          {t("agent.trimmed")}
        </p>
      )}
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
              <div className="qcms-assistant__said">
                <p className="qcms-assistant__speaker">{t("agent.speaker.you")}</p>
                <div className="qcms-assistant__bubble">
                  <AssistMarkdown text={turn.content} />
                </div>
              </div>
            </li>
          ) : (
            <li
              key={`assistant-${String(index)}`}
              className="qcms-assistant__turn"
              data-role="assistant"
            >
              <AssistMark size={20} />
              <div className="qcms-assistant__segments">
                <p className="qcms-assistant__speaker">{t("agent.speaker.assistant")}</p>
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
              <p className="qcms-assistant__speaker">{t("agent.speaker.assistant")}</p>
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
        {cards.held.map((entry) => (
          <li
            key={`held-${entry.proposal.proposalId}`}
            className="qcms-assistant__turn"
            data-role="assistant"
          >
            <ActionCard
              id={`${cardId}-held-${entry.proposal.proposalId}`}
              proposal={entry.proposal}
              card={entry.card}
              held
              remainingMs={0}
              onConfirm={noop}
              onCancel={noop}
              onStop={noop}
              onDismissReveal={(index) => {
                dismissHeldReveal(entry.proposal.proposalId, index);
              }}
            />
          </li>
        ))}
        {proposal !== undefined && card !== undefined && (
          <li className="qcms-assistant__turn" data-role="assistant">
            <ActionCard
              id={cardId}
              proposal={proposal}
              card={card}
              names={builderNames(builder)}
              reason={reason}
              remainingMs={remainingWindowMs(windowRef.current, monotonicNow())}
              onConfirm={() => void confirmCard(proposal, card)}
              onCancel={() => settle(proposal, cancelCard(card, new Date().toISOString()))}
              onStop={() => showCard(requestStop(card))}
              onDismissReveal={dismissOpenReveal}
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

/** What is on screen follows the history's own cap, so the panel's note is true of both. */
function capped(turns: readonly ShownTurn[]): readonly ShownTurn[] {
  return turns.length > CONVERSATION_TURN_CAP ? turns.slice(-CONVERSATION_TURN_CAP) : turns;
}

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
