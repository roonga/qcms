"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import {
  isTypedConfirmed,
  minutesLeft,
  planNames,
  stepTitle,
  typedConfirmation,
} from "@/lib/agent/card-copy";
import {
  canConfirm,
  headingChip,
  runningLine,
  proposalWindowMs,
  showsStepChips,
  type AgentCardView,
} from "@/lib/agent/plan-state";
import { t, tPlural } from "@/lib/i18n/en";

import { AgentCardDialog } from "./card-dialog";
import { CardFooter, IrreversibleBand, ReasonBlock, reportedResults, StepItem } from "./card-parts";

/* Proposal consequences must come from trusted step data; model prose cannot weaken the screen's own
   confirmation requirements. */

export interface ActionCardProps {
  readonly id?: string;
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
  readonly reason?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onStop: () => void;
  readonly onOpenScreen?: () => void;
  readonly focusOnArrival?: boolean;
  readonly remainingMs?: number;
  readonly onDismissReveal?: (index: number) => void;
  /** A card kept on screen only for the reveal nobody has dismissed: it reports its result no second time. */
  readonly held?: boolean;
  /** Titles the screen knows for ids the proposal only names. */
  readonly names?: ReadonlyMap<string, string> | undefined;
}

export function ActionCard(props: ActionCardProps): React.ReactElement {
  const { proposal, card } = props;
  const generated = useId();
  const base = props.id ?? generated;
  const titleId = `${base}-title`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const wasOpen = useRef(false);
  const remainingMs = props.remainingMs ?? proposalWindowMs(proposal);

  useEffect(() => {
    if (props.focusOnArrival === true) headingRef.current?.focus();
    // Focus on arrival only; later renders must not interrupt the operator.
  }, [props.focusOnArrival]);

  // The dialog hands focus back to the control that opened it, whatever closed it.
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      openRef.current?.focus();
    }
  }, [open]);

  const chips = showsStepChips(card);
  const chip = headingChip(card);
  const reported = reportedResults(card);
  const multi = proposal.steps.length > 1;
  const required = typedConfirmation(proposal.steps);
  const confirmable = canConfirm(card) && isTypedConfirmed(typed, required);
  const live = runningLine(card);
  const minutes = minutesLeft(remainingMs);
  const names = planNames(proposal, props.names);

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
        {...(props.held === true ? { "data-held": "true" } : {})}
      >
        <header className="qcms-acard__head">
          <h2 className="qcms-acard__title" id={titleId} tabIndex={-1} ref={headingRef}>
            {multi
              ? tPlural(
                  "agent.card.planTitle.one",
                  "agent.card.planTitle.other",
                  proposal.steps.length,
                )
              : stepTitle(proposal.steps[0] as AgentPlanStep, reported, proposal.steps, names)}
          </h2>
          <span className="qcms-acard__state" data-s={card.state}>
            {t(chip.key, chip.params)}
          </span>
        </header>

        <IrreversibleBand steps={proposal.steps} />

        <ol className="qcms-acard__steps" aria-label={t("agent.card.stepsLabel")}>
          {proposal.steps.map((step, index) => (
            <StepItem
              key={`${step.kind}-${String(index)}`}
              step={step}
              index={index}
              view={card.steps[index]}
              reported={reported}
              chips={chips}
              numbered={multi}
              titled={multi}
              names={names}
              steps={proposal.steps}
              idBase={base}
              onDismissReveal={props.onDismissReveal}
            />
          ))}
        </ol>

        <ReasonBlock reason={props.reason} />

        <CardFooter
          card={card}
          steps={proposal.steps.length}
          confirmable={confirmable}
          minutes={minutes}
          typed={typed}
          onTyped={setTyped}
          required={required}
          idBase={base}
          reportsResult={!open && props.held !== true}
          onConfirm={props.onConfirm}
          onCancel={props.onCancel}
          onStop={props.onStop}
          onOpenScreen={props.onOpenScreen}
          trailing={
            <button
              className="qcms-acard__link"
              type="button"
              data-testid="qcms-acard-open"
              ref={openRef}
              onClick={() => {
                setOpen(true);
              }}
            >
              {t("agent.card.open")}
            </button>
          }
        />
      </article>

      {open ? (
        <AgentCardDialog
          proposal={proposal}
          card={card}
          names={names}
          reason={props.reason}
          minutes={minutes}
          confirmable={confirmable}
          typed={typed}
          onTyped={setTyped}
          required={required}
          idBase={`${base}-dialog`}
          onDismissReveal={props.onDismissReveal}
          onConfirm={props.onConfirm}
          onCancel={props.onCancel}
          onStop={props.onStop}
          onOpenScreen={
            props.onOpenScreen === undefined
              ? undefined
              : () => {
                  setOpen(false);
                  props.onOpenScreen?.();
                }
          }
          onClose={() => setOpen(false)}
        />
      ) : null}

      {open ? null : (
        <p className="qcms-visually-hidden" role="status">
          {live === undefined ? "" : t(live.key, live.params)}
        </p>
      )}
    </>
  );
}
