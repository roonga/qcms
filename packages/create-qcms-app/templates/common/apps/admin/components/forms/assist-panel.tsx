"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Alert, Button, Card } from "@/components/kit";
import {
  isProseTurn,
  type AgentTurnRecord,
  type ConversationHandle,
} from "@/lib/agent/conversation";
import type { ResolvedScreen } from "@/lib/agent/screens";
import {
  acceptedDraft,
  isPendingNewQuestionPin,
  pendingNewQuestionPins,
  proposalDiff,
  type DiffEntry,
} from "@/lib/forms/assist-diff";
import {
  readAssistEvents,
  type AssistErrorCode,
  type AssistEvent,
  type AssistProposal,
  type AssistTurn,
} from "@/lib/forms/assist-stream";
import {
  applyTurnEvent,
  EMPTY_TURN,
  finishTurn,
  runningStep,
  turnText,
  type AssistantTurnView,
  type StepState,
  type TurnSegment,
  type TurnStep,
} from "@/lib/forms/assist-turn";
import type { DraftForm, FormIssue } from "@/lib/forms/types";
import { t, tPlural, type MessageKey } from "@/lib/i18n/en";

import { AssistIconButton } from "./assist-icon-button";
import { AssistMark } from "./assist-mark";
import { AssistMarkdown } from "./assist-markdown";
import { IssueEntry } from "./validation-panel";

/**
 * The agent-authoring chat panel (task 041; work order
 * `docs/features/041-agent-form-building.md`).
 *
 * ## What owns what
 *
 * `FormBuilder` owns the working draft; this component owns the conversation. Accept
 * hands the parsed proposal up through `onAccept` and stops there - the builder is the
 * one that mutates its own draft and runs it through the *same* autosave/validation
 * loop every other edit takes (`agentAssisted: true` on that one save). Nothing here
 * calls `saveDraft` itself, and nothing here can: this module never imports
 * `lib/server/*`.
 *
 * Accept hands up the proposal's NEW question definitions alongside the draft (issue
 * #823). They are the definitions the proposed draft pins, and the save that stores the
 * draft is the one that creates them: before that they existed only in this panel's
 * diff, so accepting produced a draft pinning questions nothing had ever created. They
 * travel as opaque values, unparsed - this component renders a diff of them and has no
 * business deciding whether the kernel will take one.
 *
 * ## The guardrail surface
 *
 * There is no publish, erase, link or webhook affordance anywhere below - not
 * disabled, not hidden, simply never written. The tool allowlist is enforced
 * server-side (041); this is the UI mirroring it by construction rather than by
 * checking a permission.
 *
 * ## Streaming
 *
 * `fetch(endpoint).body` is read by `readAssistEvents` (`lib/forms/assist-stream.ts`)
 * as it arrives and folded by `lib/forms/assist-turn.ts` into the in-progress
 * assistant bubble: `text` deltas render in place as Markdown (`assist-markdown.tsx`,
 * a safe subset) with a caret after the last character, and `status` events build a
 * step timeline in plain language, each step marked done when the next status
 * arrives. A terminal `proposal` or `error` event ends the turn. `usage` carries no UI
 * surface - token counts are server-side logging only (SEC-8).
 *
 * ## The rationale is shown once
 *
 * The proposal's `rationale` is the turn's own streamed prose, so it is already in the
 * assistant bubble by the time the card arrives. The card says where to find it rather
 * than printing it a second time. A proposal that arrives with a rationale and no
 * streamed text puts the rationale in the bubble instead, so it is still shown exactly
 * once.
 *
 * ## The conversation is memory only
 *
 * Nothing about the conversation is persisted; a reload or "Start a new conversation"
 * begins again. Only the collapsed state is remembered, in `localStorage`.
 */
export function AssistPanel({
  endpoint,
  draft,
  draftUpdatedAt,
  onAccept,
  hosted = false,
  onWorkingChange,
  onStatusChange,
  conversation,
  screen,
}: {
  /** This form's assist route, e.g. `/forms/frm_x/assist` (relative to this app). */
  readonly endpoint: string;
  /** The builder's current working draft - what a proposal is diffed against. */
  readonly draft: DraftForm;
  /** The stored draft's `updatedAt`, sent as `clientState` (a 409 means it moved). */
  readonly draftUpdatedAt: string | undefined;
  /**
   * Accept: the parsed proposed draft plus the proposal's new question definitions,
   * ready for the builder's own save path.
   */
  readonly onAccept: (proposedDraft: DraftForm, newQuestions: readonly unknown[]) => void;
  /**
   * Rendered inside the shell's assistant dock, which owns the header, the mark and the
   * live region. This then draws the conversation and nothing around it, so the builder
   * screen shows the same header every other screen shows.
   */
  readonly hosted?: boolean;
  /** Hosted only: the host's header mark and its "Working" badge follow this. */
  readonly onWorkingChange?: (working: boolean) => void;
  /** Hosted only: the host's single polite live region speaks this. */
  readonly onStatusChange?: (status: string) => void;
  /**
   * Hosted only: the form subtree's conversation. The turns are held there rather than
   * here, so walking to another screen of this form keeps them and coming back restores
   * them. A restored assistant turn is its prose; its step timeline was this mount's.
   */
  readonly conversation?: ConversationHandle;
  /** Hosted only: the screen this turn is on, which travels with the turn. */
  readonly screen?: ResolvedScreen;
}) {
  const [collapsedChoice, setCollapsed] = useState(false);
  const [turns, setTurns] = useState<readonly DisplayTurn[]>(() =>
    restoredTurns(conversation?.turns),
  );
  const [inputValue, setInputValue] = useState("");
  const [live, setLive] = useState<AssistantTurnView | undefined>(undefined);
  const [proposal, setProposal] = useState<ProposalState | undefined>(undefined);
  const [panelError, setPanelError] = useState<AssistPanelError | undefined>(undefined);
  const [resultToken, setResultToken] = useState(0);

  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLLIElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Set by Stop so its abort is not reported as a provider failure. */
  const stoppedRef = useRef(false);
  const working = live !== undefined;
  // Hosted, the top-bar button is how the panel comes back, so there is no collapse and
  // nothing of the panel reaches tab storage (Q15).
  const collapsed = hosted ? false : collapsedChoice;

  useEffect(() => {
    if (hosted) return;
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // Storage may be unavailable (private browsing, disabled). Default stands.
    }
  }, [hosted]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** A card moves focus to its heading only when focus was already inside the panel. */
  useEffect(() => {
    if (proposal === undefined) return;
    const panel = panelRef.current;
    if (panel !== null && panel.contains(document.activeElement)) headingRef.current?.focus();
  }, [proposal]);

  useEffect(() => {
    if (resultToken > 0) resultRef.current?.focus();
  }, [resultToken]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Persisting is a nicety; the toggle still works for this visit.
      }
      if (!next) requestAnimationFrame(() => composerRef.current?.focus());
      return next;
    });
  }

  /** Mirror what the conversation keeps: the host restores a panel from these records. */
  function record(entries: readonly AgentTurnRecord[]) {
    conversation?.append(entries);
  }

  function newConversation() {
    if (working) return;
    conversation?.restart();
    setTurns([]);
    setProposal(undefined);
    setPanelError(undefined);
    setInputValue("");
    composerRef.current?.focus();
  }

  /** Aborting the request cancels the SSE body, which aborts the provider call; there is no second stop request. */
  function stop() {
    if (!working) return;
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  async function send() {
    const content = inputValue.trim();
    if (content === "" || working) return;

    const nextTurns: readonly DisplayTurn[] = [...turns, { role: "user", content }];
    setTurns(nextTurns);
    record([{ role: "user", content }]);
    setInputValue("");
    setPanelError(undefined);
    setProposal(undefined);
    setLive(EMPTY_TURN);

    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation: toConversation(nextTurns),
          ...(draftUpdatedAt === undefined ? {} : { clientState: draftUpdatedAt }),
          ...(screen === undefined ? {} : { screen: screen.screen, params: screen.params }),
          ...(conversation === undefined ? {} : { conversationId: conversation.id }),
        }),
        signal: controller.signal,
      });
    } catch {
      setLive(undefined);
      if (!stoppedRef.current) setPanelError({ kind: "PROVIDER_ERROR" });
      return;
    }

    if (!response.ok || response.body === null) {
      setLive(undefined);
      setPanelError(await errorForResponse(response));
      return;
    }

    let view = EMPTY_TURN;
    try {
      for await (const event of readAssistEvents(response.body)) {
        view = applyTurnEvent(view, event);
        handleAssistEvent(event, draft, {
          onToolRejected: (tool) => {
            setPanelError({ kind: "TOOL_REJECTED", tool });
          },
          onProposal: (state) => {
            // The rationale is the turn's own prose. Only when none streamed does it
            // become the bubble's text, so it is shown exactly once either way.
            if (turnText(view).trim() === "" && state.proposal.rationale !== "") {
              view = applyTurnEvent(view, { type: "text", delta: state.proposal.rationale });
            }
            setProposal(state);
          },
          onError: setPanelError,
        });
        setLive(view);
      }
    } catch {
      if (!stoppedRef.current) setPanelError((current) => current ?? { kind: "PROVIDER_ERROR" });
    } finally {
      const finished = finishTurn(view);
      setLive(undefined);
      if (finished.segments.length > 0) {
        setTurns((current) => [...current, { role: "assistant", view: finished }]);
        record([{ role: "assistant", content: turnText(finished) }]);
      }
    }
  }

  /** Record a card's outcome in the conversation and move focus to it. */
  function recordOutcome(outcome: ResultOutcome) {
    setTurns((current) => [...current, { role: "result", outcome }]);
    record([{ role: "result", content: outcome }]);
    setProposal(undefined);
    setResultToken((token) => token + 1);
  }

  function accept() {
    if (proposal === undefined) return;
    onAccept(acceptedDraft(draft, proposal.proposal.proposedDraft), proposal.proposal.newQuestions);
    recordOutcome("accepted");
  }

  function discard() {
    if (proposal === undefined) return;
    recordOutcome("discarded");
  }

  const statusText = computeStatusText(live, proposal);
  const hasConversation = turns.length > 0 || live !== undefined;

  useEffect(() => {
    onWorkingChange?.(working);
  }, [onWorkingChange, working]);

  useEffect(() => {
    onStatusChange?.(statusText);
  }, [onStatusChange, statusText]);

  return (
    <aside
      ref={panelRef}
      // Hosted, the dock is the `complementary` landmark named "Assistant", so this
      // element carries no second one.
      {...(hosted
        ? { role: "presentation" as const }
        : { "aria-labelledby": "qcms-assist-heading" })}
      data-testid="qcms-assist-panel"
      className={hosted ? "qcms-assist qcms-assist--hosted" : "qcms-assist"}
    >
      {!hosted && (
        <div className="qcms-assist__header">
          <AssistMark id="qcms-assist-heading" size={24} working={working} />
          <div className="qcms-assist__actions">
            {!collapsed && (
              <AssistIconButton
                label={t("forms.assist.newConversation")}
                onPress={newConversation}
                isDisabled={working || (turns.length === 0 && proposal === undefined)}
                testId="qcms-assist-new"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </AssistIconButton>
            )}
            <AssistIconButton
              label={collapsed ? t("forms.assist.expand") : t("forms.assist.collapse")}
              onPress={toggleCollapsed}
              expanded={!collapsed}
              controls={BODY_ID}
              testId="qcms-assist-toggle"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path
                  d={collapsed ? "m6 9 6 6 6-6" : "m18 15-6-6-6 6"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </AssistIconButton>
          </div>
        </div>
      )}

      {!collapsed && (
        <div id={BODY_ID} className="qcms-assist__body">
          {/* Hosted, the dock's own region is the one that speaks, so there is one. */}
          {!hosted && (
            <p
              aria-live="polite"
              aria-busy={working}
              data-testid="qcms-assist-status"
              className="qcms-visually-hidden"
            >
              {statusText}
            </p>
          )}

          {!hasConversation ? (
            <p className="text-sm text-(--color-text-muted)">{t("forms.assist.emptyHint")}</p>
          ) : (
            <ol
              aria-label={t("forms.assist.conversationLabel")}
              data-testid="qcms-assist-conversation"
              className="qcms-assist-chat"
            >
              {turns.map((turn, index) => (
                <TurnBubble
                  key={`${turn.role}:${String(index)}`}
                  turn={turn}
                  resultRef={index === turns.length - 1 ? resultRef : undefined}
                />
              ))}
              {live !== undefined && <TurnBubble turn={{ role: "assistant", view: live }} live />}
            </ol>
          )}

          {panelError !== undefined && (
            <div data-testid="qcms-assist-error">
              <Alert variant="error">{messageForError(panelError)}</Alert>
            </div>
          )}

          {proposal !== undefined && (
            <section
              data-testid="qcms-assist-proposal"
              aria-labelledby="qcms-assist-proposal-heading"
            >
              <Card padding="md" border>
                <div className="qcms-assist-card">
                  <div className="flex flex-col gap-1">
                    <h3
                      ref={headingRef}
                      tabIndex={-1}
                      id="qcms-assist-proposal-heading"
                      className="text-base font-semibold text-(--color-text)"
                    >
                      {t("forms.assist.proposalHeading")}
                    </h3>
                    <p className="text-sm text-(--color-text-muted)">
                      {tPlural(
                        "forms.assist.diffCount.one",
                        "forms.assist.diffCount.other",
                        proposal.diff.length,
                      )}
                    </p>
                    {proposal.proposal.rationale !== "" && (
                      <p
                        className="text-sm text-(--color-text-muted)"
                        data-testid="qcms-assist-rationale-ref"
                      >
                        {t("forms.assist.rationaleAbove")}
                      </p>
                    )}
                  </div>

                  <ul className="flex flex-col gap-2 text-sm" data-testid="qcms-assist-diff">
                    {proposal.diff.length === 0 ? (
                      <li>{t("forms.assist.diffEmpty")}</li>
                    ) : (
                      proposal.diff.map((entry) => (
                        <li key={`${entry.kind}:${entry.id}`}>
                          <details>
                            <summary>{diffLineText(entry)}</summary>
                            <pre className="whitespace-pre-wrap text-xs text-(--color-text-muted)">
                              {entry.detail}
                            </pre>
                          </details>
                        </li>
                      ))
                    )}
                  </ul>

                  <div data-testid="qcms-assist-validation" className="text-sm">
                    {proposal.proposal.issues.length === 0 ? (
                      <p>{t("forms.assist.validationClean")}</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {proposal.proposal.issues.map((issue, index) => (
                          <li key={`${issue.code}:${String(index)}`}>
                            <ProposalIssue
                              issue={issue}
                              draft={draft}
                              pendingPins={proposal.pendingPins}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* The second advisory channel, kept separate from the first for the
                      reason `validation-panel.tsx` states at length: an issue is why a
                      publish is refused and a warning blocks nothing, so folding the two
                      counts together leaves an author unable to tell which one stops
                      them. Same heading and same summary sentence as the builder's own
                      panel, because it is the same verdict about the same draft - the
                      server ran 022's validation once and both surfaces show its two
                      lists. */}
                  {proposal.proposal.warnings.length > 0 && (
                    <div data-testid="qcms-assist-warnings" className="flex flex-col gap-2 text-sm">
                      <h4 className="font-semibold text-(--color-text)">
                        {t("forms.warning.heading")}
                      </h4>
                      <p className="text-(--color-text-muted)">
                        {tPlural(
                          "forms.warning.countOne",
                          "forms.warning.count",
                          proposal.proposal.warnings.length,
                        )}
                      </p>
                      <ul className="flex flex-col gap-2">
                        {proposal.proposal.warnings.map((warning, index) => (
                          <li key={`${warning.code}:${String(index)}`}>
                            <IssueEntry issue={warning} draft={draft} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="qcms-assist-card__actions">
                    <div data-testid="qcms-assist-accept">
                      <Button variant="primary" size="md" onPress={accept}>
                        {t("forms.assist.accept")}
                      </Button>
                    </div>
                    <div data-testid="qcms-assist-discard">
                      <Button variant="secondary" size="md" onPress={discard}>
                        {t("forms.assist.discard")}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </section>
          )}

          {/* Never disabled while a turn runs, so typing is not interrupted; only Send is. */}
          <div className="qcms-assist-composer">
            <label className="qcms-assist-composer__label" htmlFor={COMPOSER_ID}>
              {t("forms.assist.inputLabel")}
            </label>
            <div data-testid="qcms-assist-input">
              <textarea
                id={COMPOSER_ID}
                ref={composerRef}
                className="qcms-assist-composer__input"
                rows={3}
                value={inputValue}
                onChange={(event) => {
                  setInputValue(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  // An IME composition owns Enter.
                  if (event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void send();
                }}
              />
            </div>
            <p className="qcms-assist-composer__hint">{t("forms.assist.composerHint")}</p>
            <div className="qcms-assist-composer__actions">
              {working ? (
                <div data-testid="qcms-assist-stop">
                  <Button variant="secondary" size="md" onPress={stop}>
                    {t("forms.assist.stop")}
                  </Button>
                </div>
              ) : undefined}
              <div data-testid="qcms-assist-send">
                <Button
                  variant="primary"
                  size="md"
                  isDisabled={working || inputValue.trim() === ""}
                  onPress={() => {
                    void send();
                  }}
                >
                  {t("forms.assist.send")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * The turns a restored conversation shows. An assistant turn comes back as its prose: the
 * step timeline belonged to the mount that streamed it, and the prose is also exactly what
 * the next request replays.
 */
function restoredTurns(records: readonly AgentTurnRecord[] | undefined): readonly DisplayTurn[] {
  // An `action-result` record is a card's own report, already on screen as that card's
  // result line, so it is history for the model rather than a turn to redisplay.
  return (records ?? []).filter(isProseTurn).map((entry): DisplayTurn => {
    if (entry.role === "user") return { role: "user", content: entry.content };
    if (entry.role === "result") {
      return { role: "result", outcome: entry.content === "accepted" ? "accepted" : "discarded" };
    }
    return {
      role: "assistant",
      view: finishTurn(applyTurnEvent(EMPTY_TURN, { type: "text", delta: entry.content })),
    };
  });
}

const COLLAPSE_STORAGE_KEY = "qcms-assist-collapsed";
const BODY_ID = "qcms-assist-body";
const COMPOSER_ID = "qcms-assist-composer";

type ResultOutcome = "accepted" | "discarded";

const RESULT_LABELS: Readonly<Record<ResultOutcome, MessageKey>> = {
  accepted: "forms.assist.resultAccepted",
  discarded: "forms.assist.resultDiscarded",
};

/** One turn as the panel shows it. The assistant's is a timeline, not a string. */
type DisplayTurn =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly view: AssistantTurnView }
  | { readonly role: "result"; readonly outcome: ResultOutcome };

/**
 * The history the API is sent: each turn's prose, exactly as before the timeline
 * existed. An assistant turn that said nothing (only steps, or an error) is left out,
 * as it always was, and a card's outcome line is the panel's own record rather than
 * something the model is told - telling it is 083's `action-result` turn, under a
 * closed schema the request shape does not carry yet.
 */
function toConversation(turns: readonly DisplayTurn[]): readonly AssistTurn[] {
  return turns.flatMap((turn): AssistTurn[] => {
    if (turn.role === "user") return [turn];
    if (turn.role === "result") return [];
    const content = turnText(turn.view);
    return content === "" ? [] : [{ role: "assistant", content }];
  });
}

/**
 * One chat bubble. A user turn is its own words, as typed; an assistant turn is its
 * segments in arrival order - prose as Markdown, steps as a timeline. The live bubble is
 * `aria-busy` and carries the caret after its last prose, so a screen reader is not read
 * the reply token by token and a sighted reader sees where the text is growing.
 */
function TurnBubble({
  turn,
  live = false,
  resultRef,
}: {
  readonly turn: DisplayTurn;
  readonly live?: boolean;
  readonly resultRef?: RefObject<HTMLLIElement | null> | undefined;
}) {
  if (turn.role === "user") {
    return (
      <li className="qcms-assist-bubble qcms-assist-bubble--user" data-role="user">
        <span className="qcms-visually-hidden">{t("forms.assist.turnYou")}: </span>
        <span className="whitespace-pre-wrap">{turn.content}</span>
      </li>
    );
  }
  if (turn.role === "result") {
    return (
      <li
        ref={resultRef}
        tabIndex={-1}
        className="qcms-assist-bubble qcms-assist-result"
        data-role="result"
        data-testid="qcms-assist-result"
      >
        {t(RESULT_LABELS[turn.outcome])}
      </li>
    );
  }
  const segments = turn.view.segments;
  const caret = live ? <span className="qcms-assist-caret" aria-hidden="true" /> : undefined;
  const lastIsText = segments.at(-1)?.kind === "text";
  return (
    <li
      className="qcms-assist-bubble qcms-assist-bubble--assistant"
      data-role="assistant"
      aria-busy={live ? true : undefined}
      data-testid={live ? "qcms-assist-live" : undefined}
    >
      <AssistMark size={20} />
      <div className="qcms-assist-bubble__body">
        {segments.map((segment, index) => (
          <Segment
            key={`${segment.kind}:${String(index)}`}
            segment={segment}
            trailing={index === segments.length - 1 && lastIsText ? caret : undefined}
          />
        ))}
        {live && !lastIsText && (
          <p className="text-sm text-(--color-text-muted)">
            {segments.length === 0 && t("forms.assist.working")}
            {caret}
          </p>
        )}
      </div>
    </li>
  );
}

function Segment({
  segment,
  trailing,
}: {
  readonly segment: TurnSegment;
  readonly trailing: ReactNode;
}) {
  if (segment.kind === "text") return <AssistMarkdown text={segment.text} trailing={trailing} />;
  if (segment.kind === "thinking") return <ThinkingDisclosure segment={segment} />;
  return <StepTimeline steps={segment.steps} />;
}

/** Collapsed plain text: reasoning is working-out, not an answer, so it skips the Markdown subset. */
function ThinkingDisclosure({
  segment,
}: {
  readonly segment: Extract<TurnSegment, { kind: "thinking" }>;
}) {
  const running = segment.endedAt === undefined;
  const seconds = running
    ? undefined
    : Math.max(1, Math.round((segment.endedAt - segment.startedAt) / 1000));
  return (
    <details className="qcms-assist-think" data-testid="qcms-assist-thinking">
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

/** One step's icon. Each state has its own shape, so state never rests on colour. */
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

/**
 * The plain-language step list. A step that went wrong says so in words beside its
 * label; a running or finished step's state is spoken but not printed, because the
 * icon and the list's own progress already show it.
 */
function StepTimeline({ steps }: { readonly steps: readonly TurnStep[] }) {
  return (
    <ol
      className="qcms-assist-steps"
      aria-label={t("forms.assist.stepsLabel")}
      data-testid="qcms-assist-steps"
    >
      {steps.map((step, index) => {
        const problem = step.state === "failed" || step.state === "interrupted";
        return (
          <li key={`${step.label}:${String(index)}`} data-state={step.state}>
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

interface ProposalState {
  readonly proposal: AssistProposal;
  readonly diff: readonly DiffEntry[];
  /** The step pins Accept will make resolve (`pendingNewQuestionPins`), computed once. */
  readonly pendingPins: ReadonlySet<string>;
}

/** The status line: whichever of "working" or "a proposal just landed" applies. */
function computeStatusText(
  live: AssistantTurnView | undefined,
  proposal: ProposalState | undefined,
): string {
  if (live !== undefined) {
    const step = runningStep(live);
    return step === undefined ? t("forms.assist.working") : t(step.label);
  }
  if (proposal !== undefined) return proposalAnnounce(proposal.diff, proposal.proposal);
  return "";
}

/**
 * One SSE event's non-timeline effects, applied via the callbacks the caller supplies.
 * `text` and `status` are folded into the bubble by `applyTurnEvent` instead.
 */
function handleAssistEvent(
  event: AssistEvent,
  draft: DraftForm,
  handlers: {
    readonly onToolRejected: (tool: string) => void;
    readonly onProposal: (state: ProposalState) => void;
    readonly onError: (error: AssistPanelError) => void;
  },
): void {
  if (event.type === "tool-rejected") {
    handlers.onToolRejected(event.tool);
  } else if (event.type === "proposal") {
    handlers.onProposal({
      proposal: event.proposal,
      diff: proposalDiff(draft, event.proposal.proposedDraft, event.proposal.newQuestions),
      pendingPins: pendingNewQuestionPins(
        event.proposal.proposedDraft,
        event.proposal.newQuestions,
      ),
    });
  } else if (event.type === "error") {
    handlers.onError({ kind: event.code, message: event.message });
  }
}

export type AssistPanelErrorKind =
  AssistErrorCode | "TOOL_REJECTED" | "RATE_LIMITED" | "STALE_DRAFT" | "HTTP";

export interface AssistPanelError {
  readonly kind: AssistPanelErrorKind;
  readonly message?: string;
  readonly tool?: string;
  readonly retryAfter?: string;
}

/** The error kinds whose sentence needs no interpolation, keyed to the catalog. */
const SIMPLE_ERROR_MESSAGES: Readonly<
  Record<
    Exclude<AssistPanelErrorKind, "REFUSED" | "TOOL_REJECTED" | "RATE_LIMITED" | "HTTP">,
    MessageKey
  >
> = {
  PROVIDER_ERROR: "forms.assist.error.PROVIDER_ERROR",
  PROVIDER_REJECTED: "forms.assist.error.PROVIDER_REJECTED",
  NO_PROPOSAL: "forms.assist.error.NO_PROPOSAL",
  LENGTH: "forms.assist.error.LENGTH",
  STEP_LIMIT: "forms.assist.error.STEP_LIMIT",
  STALE_DRAFT: "forms.assist.error.STALE_DRAFT",
};

export function messageForError(error: AssistPanelError): string {
  if (error.kind === "REFUSED") {
    return t("forms.assist.error.REFUSED", { message: error.message ?? "" });
  }
  if (error.kind === "TOOL_REJECTED") {
    return t("forms.assist.error.TOOL_REJECTED", { tool: error.tool ?? "" });
  }
  if (error.kind === "RATE_LIMITED") {
    return error.retryAfter === undefined
      ? t("forms.assist.error.RATE_LIMITED")
      : t("forms.assist.error.RATE_LIMITED_RETRY", { seconds: error.retryAfter });
  }
  if (error.kind === "HTTP") {
    return t("forms.assist.error.HTTP", { message: error.message ?? "" });
  }
  return t(SIMPLE_ERROR_MESSAGES[error.kind]);
}

/** The HTTP-level failures the route relays as-is: 429, 409, and everything else. */
async function errorForResponse(response: Response): Promise<AssistPanelError> {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return retryAfter === null ? { kind: "RATE_LIMITED" } : { kind: "RATE_LIMITED", retryAfter };
  }
  if (response.status === 409) return { kind: "STALE_DRAFT" };
  const body: unknown = await response.json().catch(() => undefined);
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return { kind: "HTTP", message: typeof message === "string" ? message : String(response.status) };
}

/**
 * One proposal issue. Every issue renders as the builder renders it, except the one case the
 * builder never meets: a step pin on a question this same proposal invents, which Accept will
 * make resolve. Before Accept that question is not stored, so the kernel calls the pin
 * `DANGLING_QUESTION_REF`, and the builder's sentence for that code tells the author to pin a
 * question that is already pinned. Say what actually happens instead (issue #1065). It still
 * blocks a publish, so it stays in the count. Every other reference to an invented question - a
 * rule reading one no step pins, say - is genuinely dangling and keeps the builder's sentence.
 */
function ProposalIssue({
  issue,
  draft,
  pendingPins,
}: {
  readonly issue: FormIssue;
  readonly draft: DraftForm;
  readonly pendingPins: ReadonlySet<string>;
}) {
  const questionId = issue.path?.question;
  if (questionId !== undefined && isPendingNewQuestionPin(issue, pendingPins)) {
    return (
      <div data-issue-code={issue.code} data-new-question={questionId}>
        <span className="block text-sm text-(--color-text)">
          {t("forms.assist.newQuestionPending", { questionId })}
        </span>
      </div>
    );
  }
  return <IssueEntry issue={issue} draft={draft} />;
}

/**
 * The completion announcement the same live region carries once a proposal lands.
 *
 * Both advisory lists, because a reader who only hears this line is the one reader
 * who cannot glance at the card and see the warning block underneath it. The
 * publishability sentence keeps its own meaning - a warning never turns
 * "Validation passes" into a count of issues - and the warning sentence is
 * appended beside it rather than instead of it.
 */
function proposalAnnounce(diff: readonly DiffEntry[], proposal: AssistProposal): string {
  const changes = tPlural(
    "forms.assist.diffCount.one",
    "forms.assist.diffCount.other",
    diff.length,
  );
  const validation =
    proposal.issues.length === 0
      ? t("forms.assist.validationClean")
      : tPlural("forms.validation.countOne", "forms.validation.count", proposal.issues.length);
  const warned =
    proposal.warnings.length === 0
      ? ""
      : ` ${tPlural("forms.warning.countOne", "forms.warning.count", proposal.warnings.length)}`;
  return `${changes} ${validation}${warned}`;
}

const KIND_LABELS: Readonly<Record<DiffEntry["kind"], MessageKey>> = {
  step: "forms.assist.kind.step",
  question: "forms.assist.kind.question",
  rule: "forms.assist.kind.rule",
};

/** One diff line's text, marked `Added`/`Changed` - never colour alone. */
function diffLineText(entry: DiffEntry): string {
  const label = `${t(KIND_LABELS[entry.kind])}: ${entry.label}`;
  return entry.change === "added"
    ? t("forms.assist.diffAdded", { label })
    : t("forms.assist.diffChanged", { label });
}
