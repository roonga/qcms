"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Dialog } from "@/components/kit";
import { stepTitle } from "@/lib/agent/card-copy";
import {
  headingChip,
  runningLine,
  showsStepChips,
  type AgentCardView,
} from "@/lib/agent/plan-state";
import type { AgentProposal } from "@/lib/forms/assist-stream";
import { t, tPlural } from "@/lib/i18n/en";

import { CardFooter, IrreversibleBand, ReasonBlock, reportedResults, StepItem } from "./card-parts";

export interface AgentCardDialogProps {
  readonly proposal: AgentProposal;
  readonly card: AgentCardView;
  readonly reason: string | undefined;
  readonly minutes: number;
  readonly confirmable: boolean;
  readonly typed: string;
  readonly onTyped: (value: string) => void;
  readonly required: string | undefined;
  readonly idBase: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onStop: () => void;
  readonly onOpenScreen?: (() => void) | undefined;
  readonly onClose: () => void;
}

/** The plan's own pages, then one review page: Confirm lives on the review page alone. */
export function AgentCardDialog(props: AgentCardDialogProps): React.ReactElement {
  const { card, proposal } = props;
  const steps = proposal.steps;
  const wizard = steps.length > 1;
  const reviewPage = steps.length;
  const [page, setPage] = useState(wizard ? 0 : reviewPage);
  const pageRef = useRef<HTMLDivElement>(null);
  const paged = useRef(false);

  const reported = reportedResults(card);
  const chips = showsStepChips(card);
  const chip = headingChip(card);
  const live = runningLine(card);
  const settling = card.state !== "proposed";

  // A run, a cancel or an expiry leaves nothing to page through: the review page is where it reports.
  useEffect(() => {
    if (settling) setPage(reviewPage);
  }, [reviewPage, settling]);

  useEffect(() => {
    if (paged.current) pageRef.current?.focus();
    else paged.current = true;
  }, [page]);

  const first = steps[0];
  const title =
    wizard || first === undefined
      ? tPlural("agent.card.planTitle.one", "agent.card.planTitle.other", steps.length)
      : stepTitle(first, reported);
  const onReview = page >= reviewPage;
  const shown = steps[page];
  const reviewLabel = t("agent.card.wizard.reviewTitle", { count: steps.length });
  const reviewGroup = wizard ? { role: "group", "aria-label": reviewLabel } : {};

  return (
    <Dialog
      isOpen
      title={title}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <div className="qcms-acard-dialog" data-qcms-dialog="card" data-testid="qcms-acard-dialog">
        <p className="qcms-acard-dialog__chip">
          <span className="qcms-acard__state" data-s={card.state}>
            {t(chip.key, chip.params)}
          </span>
        </p>

        {onReview || shown === undefined ? (
          <div
            className="qcms-acard-dialog__page"
            data-page="review"
            {...reviewGroup}
            tabIndex={-1}
            ref={pageRef}
          >
            {wizard ? <p className="qcms-acard-dialog__progress">{reviewLabel}</p> : null}
            <IrreversibleBand steps={steps} />
            <ol className="qcms-acard__steps" aria-label={t("agent.card.stepsLabel")}>
              {steps.map((step, index) => (
                <StepItem
                  key={`${step.kind}-${String(index)}`}
                  step={step}
                  index={index}
                  view={card.steps[index]}
                  reported={reported}
                  chips={chips}
                  numbered={wizard}
                  titled={wizard}
                  idBase={props.idBase}
                />
              ))}
            </ol>
            <ReasonBlock reason={props.reason} />
          </div>
        ) : (
          <div
            className="qcms-acard-dialog__page"
            data-page={String(page + 1)}
            role="group"
            aria-label={t("agent.card.wizard.progress", {
              step: page + 1,
              count: steps.length,
            })}
            tabIndex={-1}
            ref={pageRef}
          >
            <p className="qcms-acard-dialog__progress">
              {t("agent.card.wizard.progress", { step: page + 1, count: steps.length })}
            </p>
            <IrreversibleBand steps={[shown]} />
            <ol className="qcms-acard__steps" aria-label={t("agent.card.stepsLabel")}>
              <StepItem
                step={shown}
                index={page}
                view={card.steps[page]}
                reported={reported}
                chips={chips}
                numbered
                idBase={props.idBase}
              />
            </ol>
          </div>
        )}

        {onReview ? (
          <CardFooter
            card={card}
            steps={steps.length}
            confirmable={props.confirmable}
            minutes={props.minutes}
            typed={props.typed}
            onTyped={props.onTyped}
            required={props.required}
            idBase={props.idBase}
            reportsResult
            onConfirm={props.onConfirm}
            onCancel={props.onCancel}
            onStop={props.onStop}
            onOpenScreen={props.onOpenScreen}
            leading={
              wizard && !settling ? (
                <Button
                  variant="secondary"
                  size="md"
                  onPress={() => {
                    setPage(reviewPage - 1);
                  }}
                >
                  {t("agent.card.wizard.back")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <footer className="qcms-acard__foot">
            <Button
              variant="secondary"
              size="md"
              isDisabled={page === 0}
              onPress={() => {
                setPage(page - 1);
              }}
            >
              {t("agent.card.wizard.back")}
            </Button>
            <Button
              variant="primary"
              size="md"
              onPress={() => {
                setPage(page + 1);
              }}
            >
              {t("agent.card.wizard.next")}
            </Button>
            {card.state === "proposed" ? (
              <span className="qcms-acard__expiry">
                {tPlural("agent.card.expiresIn.one", "agent.card.expiresIn.other", props.minutes)}
              </span>
            ) : null}
          </footer>
        )}

        <p className="qcms-visually-hidden" role="status">
          {live === undefined ? "" : t(live.key, live.params)}
        </p>
      </div>
    </Dialog>
  );
}
