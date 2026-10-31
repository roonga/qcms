"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import {
  isProductionStep,
  minutesLeft,
  productionSentence,
  stepArguments,
  stepConsequences,
  stepTitle,
} from "@/lib/agent/card-copy";
import {
  canConfirm,
  headingChip,
  liveLine,
  resultLine,
  showsStepChips,
  STEP_STATE_WORDS,
  type AgentCardView,
  type AgentStepState,
} from "@/lib/agent/plan-state";
import { t, tPlural, type MessageKey } from "@/lib/i18n/en";

/**
 * The action card and the plan card (083 D0, SEC-17 section 4.10). A card is a plan of
 * one step.
 *
 * ## The four rules are this component's contract
 *
 * 1. **The admin writes the card.** Every title, consequence sentence and argument label
 *    comes from `lib/agent/card-copy.ts`, which takes the step and nothing else. The
 *    model's words reach the screen in exactly one place: `reason`, rendered as quoted
 *    plain text after the steps and never above a band.
 * 2. **Every step and every argument is displayed**, in run order, in full. There is no
 *    truncation, no disclosure and no "and N more" below, by construction.
 * 3. **Never weaker than the screen's dialog.** A production step carries the production
 *    sentence inline on its own environment line, with one environment chip in that step
 *    and no boxed inset inside it (issue #1131). A step whose arguments include a secret
 *    the user must type is a hand-off: Confirm opens the screen's own field.
 * 4. **One plan, one Confirm.** Steps run in order, the run stops at the first failure
 *    and nothing is retried. The runner (`lib/agent/runner.ts`) is what sequences them;
 *    this component owns the press, the focus and the live region.
 *
 * Step chips appear only once the plan runs. While every step shares the card's state the
 * heading chip says it once and each step keeps its icon plus a visually hidden state
 * word, so the accessible name of a step row still carries it (issue #1131).
 */

export interface ActionCardProps {
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
  /** The model's own words, already clamped by the caller. The one place they appear. */
  readonly reason?: string;
  /** Pressed once: the runner takes over from here. */
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onStop: () => void;
  /** Opens the screen the first not-yet-run step belongs to. */
  readonly onOpenScreen?: () => void;
  /**
   * The code the user must type before Confirm is enabled, for a step whose own dialog
   * asks for one. D4's erasure kind is the first to carry it.
   */
  readonly typedConfirmation?: string;
  /** True only when focus was already inside the panel when the card arrived. */
  readonly focusOnArrival?: boolean;
  readonly now?: number;
}

/** One shape per state, so a state is never colour alone. */
function stepIcon(state: AgentStepState): React.ReactElement {
  const common = { className: "qcms-acard__icon", viewBox: "0 0 18 18", "aria-hidden": true } as const;
  switch (state) {
    case "done":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path d="M5 9.5l2.5 2.5L13 6.5" stroke="var(--color-surface)" strokeWidth="2" fill="none" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path d="M6 6l6 6M12 6l-6 6" stroke="var(--color-surface)" strokeWidth="2" fill="none" />
        </svg>
      );
    case "running":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3" />
          <path d="M9 2a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );
    case "pending-approval":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
          <path d="M9 5v4.5l3 1.8" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );
    case "not-run":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" fill="none" />
          <path d="M5.5 9h7" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "cancelled":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
          <path d="M4.5 13.5l9-9" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "expired":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
          <path d="M9 5v5" stroke="currentColor" strokeWidth="2" />
          <circle cx="9" cy="12.5" r="1" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );
  }
}

/** What each earlier step reported, keyed by index, which is what resolves a reference. */
function reportedResults(
  card: AgentCardView,
): Readonly<Record<number, Readonly<Record<string, string | number | boolean>>>> {
  const reported: Record<number, Readonly<Record<string, string | number | boolean>>> = {};
  for (const [index, step] of card.steps.entries()) {
    if (step.result !== undefined) reported[index] = step.result;
  }
  return reported;
}

function EnvironmentLine({ step }: { readonly step: AgentPlanStep }): React.ReactElement {
  const production = isProductionStep(step);
  return (
    <span>
      {t("agent.card.environmentLabel")}{" "}
      <span className="qcms-envchip" data-kind={production ? "prod" : "nonprod"}>
        {step.environment}
      </span>
      {production ? (
        <>
          {" · "}
          <span className="qcms-acard__label">{productionSentence()}</span>
        </>
      ) : null}
    </span>
  );
}

export function ActionCard(props: ActionCardProps): React.ReactElement {
  const { proposal, card } = props;
  const base = useId();
  const titleId = `${base}-title`;
  const resultId = `${base}-result`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const [typed, setTyped] = useState("");
  const now = props.now ?? Date.now();

  useEffect(() => {
    if (props.focusOnArrival === true) headingRef.current?.focus();
    // Arrival only: a later render must not steal focus from whatever the user is doing.
  }, [props.focusOnArrival]);

  const settled = resultLine(card);
  useEffect(() => {
    if (settled !== undefined) resultRef.current?.focus();
  }, [settled]);

  const chips = showsStepChips(card);
  const chip = headingChip(card);
  const reported = reportedResults(card);
  const multi = proposal.steps.length > 1;
  const typedGate =
    props.typedConfirmation === undefined ||
    typed.trim().toUpperCase() === props.typedConfirmation.toUpperCase();
  const confirmable = canConfirm(card) && typedGate;
  const live = liveLine(card);

  /**
   * Escape cancels the card, never the turn (section 4.3). While a step is in flight the
   * only cancellation that exists is Stop: a request already sent cannot be recalled, and
   * saying it was would be a weaker card than the screen.
   */
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (card.state === "proposed") props.onCancel();
    else if (card.state === "running" && !card.stopping) props.onStop();
  }

  return (
    <>
      <article
        className="qcms-acard"
        id={base}
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="qcms-acard__head">
          <h2 className="qcms-acard__title" id={titleId} tabIndex={-1} ref={headingRef}>
            {multi
              ? tPlural("agent.card.planTitle.one", "agent.card.planTitle.other", proposal.steps.length)
              : stepTitle(proposal.steps[0] as AgentPlanStep, reported)}
          </h2>
          <span className="qcms-acard__state" data-s={card.state}>
            {t(chip.key, chip.params)}
          </span>
        </header>

        <ol className="qcms-acard__steps" aria-label={t("agent.card.stepsLabel")}>
          {proposal.steps.map((step, index) => {
            const view = card.steps[index];
            const state = view?.state ?? "proposed";
            const word = t(STEP_STATE_WORDS[state]);
            return (
              <li className="qcms-acard__step" data-s={state} key={`${step.kind}-${String(index)}`}>
                {stepIcon(state)}
                <span className="qcms-acard__what">
                  {multi ? `${String(index + 1)}. ` : ""}
                  {stepTitle(step, reported)}
                </span>
                {chips ? (
                  <span className="qcms-acard__state" data-s={state}>
                    {word}
                  </span>
                ) : (
                  <span className="qcms-visually-hidden">{word}</span>
                )}
                <p className="qcms-acard__args">
                  <EnvironmentLine step={step} />
                  {stepArguments(step, reported).map((line) => (
                    <span key={line.name}>
                      {line.label}{" "}
                      {line.mono ? <code>{line.value}</code> : <span>{line.value}</span>}
                    </span>
                  ))}
                  {stepConsequences(step).map((sentence) => (
                    <span key={sentence}>{sentence}</span>
                  ))}
                  {step.handOff ? <span>{t("agent.card.handOffHint")}</span> : null}
                </p>
                {view?.message === undefined ? null : (
                  <p className="qcms-acard__note">{view.message}</p>
                )}
              </li>
            );
          })}
        </ol>

        {props.reason === undefined || props.reason === "" ? null : (
          <div className="qcms-acard__reason">
            <span>
              <AssistMark size={16} />
              {t("agent.card.reasonLabel")}
            </span>
            <q>{props.reason}</q>
          </div>
        )}

        <footer className="qcms-acard__foot">
          {props.typedConfirmation === undefined || !canConfirm(card) ? null : (
            <div className="qcms-field qcms-acard__typed">
              <label className="qcms-field__label" htmlFor={`${base}-typed`}>
                {props.typedConfirmation}
              </label>
              <input
                className="qcms-input qcms-input--mono"
                id={`${base}-typed`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          )}

          {card.state === "running" ? (
            <button
              className="qcms-button qcms-button--secondary"
              type="button"
              onClick={props.onStop}
              disabled={card.stopping}
            >
              {t(card.stopping ? "agent.card.stopping" : "agent.card.stop")}
            </button>
          ) : null}

          {card.state === "proposed" || card.state === "expired" ? (
            <button
              className="qcms-button qcms-button--primary"
              type="button"
              onClick={props.onConfirm}
              disabled={!confirmable}
            >
              {multi
                ? t("agent.card.confirmAll", { count: proposal.steps.length })
                : t("agent.card.confirm")}
            </button>
          ) : null}

          {card.state === "proposed" ? (
            <button className="qcms-button qcms-button--ghost" type="button" onClick={props.onCancel}>
              {t("agent.card.cancel")}
            </button>
          ) : null}

          {!multi && props.onOpenScreen !== undefined ? (
            <button className="qcms-acard__link" type="button" onClick={props.onOpenScreen}>
              {t("agent.card.openScreen")}
            </button>
          ) : null}

          {card.state === "proposed" ? (
            <span className="qcms-acard__expiry">
              {tPlural(
                "agent.card.expiresIn.one",
                "agent.card.expiresIn.other",
                minutesLeft(proposal.expiresAt, now),
              )}
            </span>
          ) : null}

          {card.state === "expired" ? (
            <span className="qcms-acard__expiry">{t("agent.card.expiredAsk")}</span>
          ) : null}

          {settled === undefined ? null : (
            <p className="qcms-acard__result" id={resultId} tabIndex={-1} ref={resultRef}>
              {t(settled.key, settled.params)}
            </p>
          )}
        </footer>
      </article>

      {/* Progress in words, one polite region, never token by token. */}
      <p className="qcms-visually-hidden" role="status">
        {live === undefined ? "" : t(live.key as MessageKey, live.params)}
      </p>
    </>
  );
}
