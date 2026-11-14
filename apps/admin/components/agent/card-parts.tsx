"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import { Button } from "@/components/kit";
import type { AgentPlanStep } from "@/lib/forms/assist-stream";
import { copyMintedUrl, downloadMintedLinks } from "@/lib/forms/links";
import {
  createdHref,
  hasIrreversibleStep,
  isProductionStep,
  productionSentence,
  stepArguments,
  stepConsequences,
  stepTitle,
  type PlanNames,
  type StepArgumentLine,
} from "@/lib/agent/card-copy";
import { focusPostAction } from "@/lib/ops/post-action-focus";
import { plainQuote, REASON_CHARS } from "@/lib/agent/reason";
import {
  resultLine,
  STEP_STATE_WORDS,
  type AgentCardView,
  type AgentStepState,
  type AgentStepView,
  type ReportedResults,
  type StepReveal,
} from "@/lib/agent/plan-state";
import { t, tPlural } from "@/lib/i18n/en";

import { ApplyDraftDetail } from "./apply-draft-detail";
import { DefinitionDetail } from "./definition-detail";

/* Proposal consequences must come from trusted step data; model prose cannot weaken the screen's own
   confirmation requirements. */

const DEFINITION_ARGUMENT = "definition";

/* The kinds whose `definition` argument is a question definition rather than a form draft. */
const QUESTION_DEFINITION_KINDS: readonly string[] = ["question.create", "question.saveDraft"];

export function stepIcon(state: AgentStepState): React.ReactElement {
  const common = {
    className: "qcms-acard__icon",
    viewBox: "0 0 18 18",
    "aria-hidden": true,
  } as const;
  switch (state) {
    case "done":
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path
            d="M5 9.5l2.5 2.5L13 6.5"
            stroke="var(--color-surface)"
            strokeWidth="2"
            fill="none"
          />
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
          <circle
            cx="9"
            cy="9"
            r="7"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            opacity="0.3"
          />
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
          <path d="M4 9h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "cancelled":
      return (
        <svg {...common} focusable="false">
          <path d="M4.5 13.5l9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "expired":
      return (
        <svg {...common} focusable="false">
          <path d="M9 4v6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="9" cy="13.5" r="1.2" fill="currentColor" />
        </svg>
      );
    // An outlined circle beside a step reads as a radio button nobody can pick.
    default:
      return (
        <svg {...common} focusable="false">
          <circle cx="9" cy="9" r="3.5" fill="currentColor" />
        </svg>
      );
  }
}

export function reportedResults(card: AgentCardView): ReportedResults {
  const reported: Record<number, NonNullable<AgentStepView["result"]>> = {};
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

/* A bearer address is written on the screen, never into an announcement: the live region below carries
   the outcome of a copy in words and nothing else. */
function RevealBlock({
  reveal,
  formId,
  idBase,
  index,
  onDismiss,
}: {
  readonly reveal: StepReveal;
  readonly formId: string;
  readonly idBase: string;
  readonly index: number;
  readonly onDismiss: (() => void) | undefined;
}): React.ReactElement {
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const asked = useRef(false);
  const hideRef = useRef<HTMLSpanElement>(null);
  const keepRef = useRef<HTMLSpanElement>(null);
  const base = `${idBase}-${String(index)}-reveal`;
  const secret = typeof reveal === "string" ? reveal : undefined;
  const links = typeof reveal === "string" ? [] : reveal;
  const count = secret === undefined ? links.length : 1;

  // The question takes focus on its keeping answer, so the answer that cannot be undone is never the
  // one a second keypress lands on.
  useEffect(() => {
    if (asking) {
      asked.current = true;
      return focusPostAction(keepRef.current?.querySelector("button") ?? null);
    }
    if (!asked.current) return undefined;
    asked.current = false;
    return focusPostAction(hideRef.current?.querySelector("button") ?? null);
  }, [asking]);

  const copy = useCallback((url: string) => {
    void copyMintedUrl(url).then(
      (key) => {
        setNote(t(key));
      },
      () => {
        setNote(t("forms.links.copyFailed"));
      },
    );
  }, []);

  return (
    <div
      className="qcms-acard__reveal"
      role="group"
      aria-labelledby={`${base}-title`}
      data-testid="qcms-acard-reveal"
    >
      <p className="qcms-acard__label" id={`${base}-title`}>
        {secret === undefined
          ? tPlural("agent.card.reveal.links.one", "agent.card.reveal.links.other", links.length)
          : t("agent.card.revealOnce")}
      </p>

      {secret === undefined ? (
        <>
          <p>{t("agent.card.reveal.links.note")}</p>
          <ul
            className="qcms-acard__reveal-list"
            aria-labelledby={`${base}-title`}
            data-testid="qcms-acard-reveal-list"
            tabIndex={0}
          >
            {links.map((link, at) => (
              <li key={link.linkId}>
                <code className="qcms-link-url">{link.url}</code>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    copy(link.url);
                  }}
                >
                  <span className="qcms-visually-hidden">
                    {t("agent.card.reveal.copyNumbered", { number: at + 1 })}
                  </span>
                  <span aria-hidden="true">{t("agent.card.reveal.copy")}</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <code>{secret}</code>
      )}

      {!asking ? null : (
        <p className="qcms-acard__label" data-testid="qcms-acard-reveal-ask">
          {tPlural("agent.card.reveal.dismissAsk.one", "agent.card.reveal.dismissAsk.other", count)}
        </p>
      )}

      <div className="qcms-acard__reveal-controls">
        {secret !== undefined ? null : (
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              downloadMintedLinks(formId, links);
            }}
          >
            {t("agent.card.reveal.csv")}
          </Button>
        )}
        {onDismiss === undefined || asking ? null : (
          <span ref={hideRef}>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setAsking(true);
              }}
            >
              {t("agent.card.reveal.dismiss")}
            </Button>
          </span>
        )}
        {onDismiss === undefined || !asking ? null : (
          <>
            <span ref={keepRef}>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => {
                  setAsking(false);
                }}
              >
                {t("agent.card.reveal.dismissKeep")}
              </Button>
            </span>
            <Button variant="danger" size="sm" onPress={onDismiss}>
              {t("agent.card.reveal.dismissFinal")}
            </Button>
          </>
        )}
      </div>

      {onDismiss === undefined || asking ? null : (
        <p>
          {tPlural(
            "agent.card.reveal.dismissHint.one",
            "agent.card.reveal.dismissHint.other",
            count,
          )}
        </p>
      )}

      <p aria-live="polite" data-testid="qcms-acard-reveal-note">
        {note}
      </p>
    </div>
  );
}

function dismissHandler(
  onDismissReveal: ((index: number) => void) | undefined,
  index: number,
): (() => void) | undefined {
  if (onDismissReveal === undefined) return undefined;
  return () => {
    onDismissReveal(index);
  };
}

export interface StepItemProps {
  readonly step: AgentPlanStep;
  readonly index: number;
  readonly view: AgentStepView | undefined;
  readonly reported: ReportedResults;
  readonly chips: boolean;
  readonly numbered: boolean;
  readonly names?: PlanNames;
  /** The whole plan, so a title can name what an earlier step will make. */
  readonly steps?: readonly AgentPlanStep[];
  /** A single-step dialog titles itself with the step, so the step does not repeat it. */
  readonly titled?: boolean;
  readonly idBase: string;
  readonly onDismissReveal?: ((index: number) => void) | undefined;
}

export function StepItem({
  step,
  index,
  view,
  reported,
  chips,
  numbered,
  titled = true,
  names,
  steps,
  idBase,
  onDismissReveal,
}: StepItemProps): React.ReactElement {
  const state = view?.state ?? "proposed";
  const word = t(STEP_STATE_WORDS[state]);
  const href = createdHref(step, view?.result);
  // A form draft is already shown as a diff and two advisory lists; a question definition
  // gets its own field-by-field rendering rather than one line of JSON.
  const readable = QUESTION_DEFINITION_KINDS.includes(step.kind);
  const lines = stepArguments(step, reported, names)
    // A definition shown field by field, or as a diff and two advisory lists, is not
    // also shown as a line of JSON.
    .filter((line) => line.name !== DEFINITION_ARGUMENT || !(readable || step.draft !== undefined));
  return (
    <li className="qcms-acard__step" data-s={state}>
      {stepIcon(state)}
      {titled ? (
        <span className="qcms-acard__what">
          {numbered ? `${String(index + 1)}. ` : ""}
          {stepTitle(step, reported, steps, names)}
        </span>
      ) : null}
      {chips ? (
        <span className="qcms-acard__state" data-s={state}>
          {word}
        </span>
      ) : (
        <span className="qcms-visually-hidden">{word}</span>
      )}
      <p className="qcms-acard__args">
        {step.card.hideEnvironment === true ? null : <EnvironmentLine step={step} />}
        {lines.map(argumentLine)}
        {stepConsequences(step).map((sentence) => (
          <span key={sentence}>{sentence}</span>
        ))}
        {step.handOff ? <span>{t("agent.card.handOffHint")}</span> : null}
      </p>
      <IdentifierDetail lines={lines} />
      {readable ? <DefinitionDetail definition={step.args[DEFINITION_ARGUMENT]} /> : null}
      {step.draft === undefined ? null : (
        <ApplyDraftDetail draft={step.draft} id={`${idBase}-${String(index)}`} />
      )}
      {view?.message === undefined ? null : <p className="qcms-acard__note">{view.message}</p>}
      {view?.issues === undefined || view.issues.length === 0 ? null : (
        <ul className="qcms-acard__advisory" data-testid="qcms-acard-step-issues">
          {view.issues.map((issue, at) => (
            <li key={`${issue.code}:${String(at)}`} data-issue-code={issue.code}>
              {issue.path === undefined || issue.path === ""
                ? issue.message
                : `${issue.path}: ${issue.message}`}
            </li>
          ))}
        </ul>
      )}
      {href === undefined ? null : (
        <p className="qcms-acard__note">
          <a className="qcms-acard__link" href={href}>
            {t("agent.card.openCreated")}
          </a>
        </p>
      )}
      {view?.revealed === undefined ? null : (
        <RevealBlock
          reveal={view.revealed}
          formId={typeof step.args["formId"] === "string" ? step.args["formId"] : ""}
          idBase={idBase}
          index={index}
          onDismiss={dismissHandler(onDismissReveal, index)}
        />
      )}
    </li>
  );
}

function argumentLine(line: StepArgumentLine): React.ReactElement {
  return (
    <span key={line.name}>
      {line.label} {line.mono ? <code>{line.value}</code> : <span>{line.value}</span>}
    </span>
  );
}

/* The card names its subject by title; the id behind that title stays reachable for support. */
function IdentifierDetail({
  lines,
}: {
  readonly lines: readonly StepArgumentLine[];
}): React.ReactElement | null {
  const ids = lines.filter((line) => line.id !== undefined);
  if (ids.length === 0) return null;
  return (
    <details className="qcms-acard__ids" data-testid="qcms-acard-ids">
      <summary>{t("agent.card.ids")}</summary>
      <p className="qcms-acard__args">
        {ids.map((line) => (
          <span key={line.name}>
            {line.label} <code>{line.id}</code>
          </span>
        ))}
      </p>
    </details>
  );
}

export function IrreversibleBand({
  steps,
}: {
  readonly steps: readonly AgentPlanStep[];
}): React.ReactElement | null {
  if (!hasIrreversibleStep(steps)) return null;
  return (
    <p className="qcms-acard__band" data-kind="irreversible">
      {t("agent.card.band.irreversible")}
    </p>
  );
}

export function ReasonBlock({
  reason,
}: {
  readonly reason: string | undefined;
}): React.ReactElement | null {
  const quoted = plainQuote(reason, REASON_CHARS);
  if (quoted === undefined) return null;
  return (
    <div className="qcms-acard__reason">
      <span>
        <AssistMark size={16} />
        {t("agent.card.reasonLabel")}
      </span>
      <q>{quoted}</q>
    </div>
  );
}

export interface CardFooterProps {
  readonly card: AgentCardView;
  readonly steps: number;
  readonly confirmable: boolean;
  readonly minutes: number;
  readonly typed: string;
  readonly onTyped: (value: string) => void;
  readonly required: string | undefined;
  readonly idBase: string;
  /** Only the view the operator is looking at reports the outcome and pulls focus to it. */
  readonly reportsResult: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onStop: () => void;
  readonly onOpenScreen?: (() => void) | undefined;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}

export function CardFooter(props: CardFooterProps): React.ReactElement {
  const { card, idBase, steps } = props;
  const waiting = card.state === "proposed";
  const multi = steps > 1;
  // Hold the line's identity to the card it was read from; a fresh object each render would
  // move focus off whatever the operator is typing in.
  const settled = useMemo(() => resultLine(card), [card]);
  const resultRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (settled !== undefined && props.reportsResult) resultRef.current?.focus();
  }, [props.reportsResult, settled]);

  return (
    <footer className="qcms-acard__foot">
      {props.required === undefined || !waiting ? null : (
        <div className="qcms-field qcms-acard__typed">
          <label className="qcms-field__label" htmlFor={`${idBase}-typed`}>
            {t("agent.card.typed.label")}
          </label>
          <input
            aria-describedby={`${idBase}-typed-hint`}
            className="qcms-input qcms-input--mono"
            id={`${idBase}-typed`}
            value={props.typed}
            onChange={(event) => props.onTyped(event.target.value)}
          />
          <p className="qcms-field__hint" id={`${idBase}-typed-hint`}>
            {t("agent.card.typed.hint", { value: props.required })}
          </p>
        </div>
      )}

      {props.leading}

      {card.state === "running" ? (
        <Button variant="secondary" size="md" isDisabled={card.stopping} onPress={props.onStop}>
          {t(card.stopping ? "agent.card.stopping" : "agent.card.stop")}
        </Button>
      ) : null}

      {waiting || card.state === "expired" ? (
        <Button
          variant="primary"
          size="md"
          isDisabled={!props.confirmable}
          onPress={props.onConfirm}
        >
          {multi ? t("agent.card.confirmAll", { count: steps }) : t("agent.card.confirm")}
        </Button>
      ) : null}

      {waiting ? (
        <Button variant="ghost" size="md" onPress={props.onCancel}>
          {t("agent.card.cancel")}
        </Button>
      ) : null}

      {props.trailing}

      {!multi && props.onOpenScreen !== undefined ? (
        <button className="qcms-acard__link" type="button" onClick={props.onOpenScreen}>
          {t("agent.card.openScreen")}
        </button>
      ) : null}

      {waiting ? (
        <span className="qcms-acard__expiry">
          {tPlural("agent.card.expiresIn.one", "agent.card.expiresIn.other", props.minutes)}
        </span>
      ) : null}

      {card.state === "expired" ? (
        <span className="qcms-acard__expiry">{t("agent.card.expiredAsk")}</span>
      ) : null}

      {settled === undefined || !props.reportsResult ? null : (
        <p className="qcms-acard__result" id={`${idBase}-result`} tabIndex={-1} ref={resultRef}>
          {t(settled.key, settled.params)}
        </p>
      )}
    </footer>
  );
}
