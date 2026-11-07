"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { HelpTip } from "@/components/help-tip";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import { Alert, Button, Dialog } from "@/components/kit";
import { EraseDialog } from "@/components/ops/erase-dialog";
import { flagReasonText } from "@/components/ops/ops-tags";
import { TombstoneCard } from "@/components/ops/tombstone-card";
import { announce } from "@/lib/announce";
import { answerText } from "@/lib/ops/answers";
import { resetEraseRequests, useEraseRequests } from "@/lib/ops/erase-request";
import type { ErasureReason } from "@/lib/ops/erasure";
import { labelFor, orderedAnswerKeys, type QuestionPin } from "@/lib/ops/labels";
import {
  claimPostActionFocus,
  focusPostAction,
  requestPostActionFocus,
  TOMBSTONE_HEADING_ID,
} from "@/lib/ops/post-action-focus";
import { unexpected } from "@/lib/ops/unexpected";
import { RESPONSE_HEADING_ID } from "@/lib/page-headings";
import type {
  EraseOutcome,
  ResponseDetail as ResponseDetailData,
  Tombstone,
} from "@/lib/ops/types";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";

export function ResponseDetail({
  detail,
  pins,
  labels,
  labelsFailed,
  linksHref,
  environment,
  erase,
  unflag,
}: {
  readonly detail: ResponseDetailData;
  readonly pins: readonly QuestionPin[];
  readonly labels: ReadonlyMap<string, string>;
  readonly labelsFailed: boolean;
  readonly linksHref: string;
  /* An erasure acts in one selected environment only; the confirmation must name it because the act cannot
     be undone. */
  readonly environment: string;
  readonly erase: (
    sessionId: string,
    reason: ErasureReason,
  ) => Promise<{
    readonly status: "erased" | "error";
    readonly data?: EraseOutcome;
    readonly message?: string;
  }>;
  readonly unflag: (sessionId: string) => Promise<{
    readonly status: "unflagged" | "error";
    readonly released?: boolean;
    readonly message?: string;
  }>;
}) {
  const [tombstone, setTombstone] = useState<Tombstone | null>(null);
  const [erasureNote, setErasureNote] = useState<string>("");
  const [unflagNote, setUnflagNote] = useState<string>("");
  const [flagged, setFlagged] = useState<string | null>(detail.flaggedReason);
  const [seededFlag, setSeededFlag] = useState<string | null>(detail.flaggedReason);
  if (seededFlag !== detail.flaggedReason) {
    setSeededFlag(detail.flaggedReason);
    setFlagged(detail.flaggedReason);
  }
  const [dialog, setDialog] = useState<"erase" | "unflag" | null>(null);
  const [released, setReleased] = useState(false);
  const [isPending, startTransition] = useTransition();
  const environmentUnknown = useEnvironmentUnknown();
  // The door is the page header's own menu, so the request arrives from another client tree.
  const eraseRequests = useEraseRequests();
  const seenErase = useRef(0);

  // Announce through the shell region because erasure revalidation unmounts this subtree mid-announcement.
  const noteErasure = useCallback((message: string) => {
    setErasureNote(message);
    announce(message);
  }, []);
  const noteUnflag = useCallback((message: string) => {
    setUnflagNote(message);
    announce(message);
  }, []);

  useEffect(() => {
    if (tombstone === null) return undefined;
    const { sessionId } = tombstone;
    requestPostActionFocus(TOMBSTONE_HEADING_ID, sessionId);
    const settled = claimPostActionFocus(TOMBSTONE_HEADING_ID, sessionId);
    return () => {
      settled?.();
      // Scope pending focus to this response and clean it up on navigation so another tombstone cannot collect
      // it.
      requestPostActionFocus(TOMBSTONE_HEADING_ID, sessionId);
    };
  }, [tombstone]);

  useEffect(() => {
    if (!released) return undefined;
    return focusPostAction(document.getElementById(RESPONSE_HEADING_ID));
  }, [released]);

  // Consume each request once, so an ordinary rerender cannot reopen a cancelled dialog.
  useEffect(() => {
    if (eraseRequests === seenErase.current) return;
    seenErase.current = eraseRequests;
    if (environmentUnknown) return;
    setErasureNote("");
    setDialog("erase");
  }, [eraseRequests, environmentUnknown]);

  useEffect(() => resetEraseRequests, []);

  const runUnflag = useCallback(() => {
    startTransition(() => {
      void unflag(detail.sessionId)
        .then((state) => {
          if (state.status === "error") {
            noteUnflag(t("ops.detail.unflagFailed", { message: state.message ?? "" }));
            return;
          }
          // Only released means this call released a withheld event; success alone may mean there was nothing
          // withheld.
          noteUnflag(
            state.released === true ? t("ops.detail.unflagged") : t("ops.detail.unflagNoop"),
          );
          setFlagged(null);
          setDialog(null);
          setReleased(true);
        })
        .catch(() => {
          noteUnflag(t("ops.detail.unflagFailed", { message: unexpected() }));
        });
    });
  }, [unflag, detail.sessionId, noteUnflag]);

  const runErase = useCallback(
    (reason: ErasureReason) => {
      startTransition(() => {
        void erase(detail.sessionId, reason)
          .then((state) => {
            if (state.status === "error" || state.data === undefined) {
              noteErasure(t("ops.erase.failed", { message: state.message ?? "" }));
              return;
            }
            setTombstone(state.data);
            noteErasure(
              state.data.alreadyErased
                ? t("ops.erase.alreadyErased")
                : t("ops.erase.done", { sessionId: detail.sessionId }),
            );
            setDialog(null);
          })
          .catch(() => {
            noteErasure(t("ops.erase.failed", { message: unexpected() }));
          });
      });
    },
    [erase, detail.sessionId, noteErasure],
  );

  return (
    <section
      aria-labelledby={RESPONSE_HEADING_ID}
      className="flex flex-col gap-6"
      data-testid="qcms-response-detail"
    >
      <div className="flex flex-col gap-2">
        {erasureNote !== "" && dialog !== "erase" && (
          <Alert variant={tombstone === null ? "error" : "success"}>{erasureNote}</Alert>
        )}
        {unflagNote !== "" && dialog !== "unflag" && <Alert variant="info">{unflagNote}</Alert>}
      </div>

      {tombstone === null ? (
        <>
          <Summary detail={detail} flagged={flagged} linksHref={linksHref} />
          {flagged !== null && (
            <div className="flex flex-col items-start gap-2" data-testid="qcms-flag-panel">
              <p className="text-sm text-(--color-text)">
                {t("ops.detail.flagged", { reason: flagReasonText(flagged) })}
              </p>
              <p className="text-sm text-(--color-text-muted)">{t("ops.detail.flaggedNote")}</p>
              <HeadingMarker control="responses.unflag">
                <Button
                  variant="secondary"
                  size="md"
                  isDisabled={isPending || environmentUnknown}
                  onPress={() => {
                    setUnflagNote("");
                    setDialog("unflag");
                  }}
                >
                  {t("ops.detail.unflag")}
                </Button>
              </HeadingMarker>
            </div>
          )}
          {labelsFailed && <Alert variant="warning">{t("ops.detail.labelsFailed")}</Alert>}
          <Answers detail={detail} pins={pins} labels={labels} />
          <LedgerTimeline detail={detail} labels={labels} />
        </>
      ) : (
        <TombstoneCard tombstone={tombstone} />
      )}

      {dialog === "unflag" && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("ops.detail.unflagTitle")}
          description={t("ops.detail.unflagBody")}
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDialog(null);
          }}
        >
          {unflagNote !== "" && <Alert variant="error">{unflagNote}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="md" isDisabled={isPending} onPress={runUnflag}>
              {isPending ? t("ops.common.working") : t("ops.detail.confirmUnflag")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                setDialog(null);
              }}
            >
              {t("ops.common.cancel")}
            </Button>
          </div>
        </Dialog>
      )}

      {dialog === "erase" && (
        <EraseDialog
          sessionId={detail.sessionId}
          environment={environment}
          isPending={isPending}
          error={tombstone === null && erasureNote !== "" ? erasureNote : undefined}
          onConfirm={runErase}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

function Summary({
  detail,
  flagged,
  linksHref,
}: {
  readonly detail: ResponseDetailData;
  readonly flagged: string | null;
  readonly linksHref: string;
}) {
  return (
    <dl className="qcms-ops-summary" data-testid="qcms-response-summary">
      <dt>{t("ops.detail.submittedAt")}</dt>
      <dd>
        <OperatorDateTime iso={detail.submittedAt} fallback={t("ops.common.none")} />
      </dd>
      <dt>{t("ops.detail.version")}</dt>
      <dd>v{detail.formVersion}</dd>
      <dt>{t("ops.detail.access")}</dt>
      <dd>
        {t(`ops.responses.access.${detail.accessMode}`)}
        {detail.accessMode === "secure_link" && (
          <>
            {" "}
            <span className="text-(--color-text-muted)">{t("ops.detail.secureLinkNote")}</span>{" "}
            <Link className="qcms-text-link" href={linksHref}>
              {t("ops.detail.secureLinkGo")}
            </Link>
          </>
        )}
      </dd>
      <dt>
        {t("ops.detail.contentHash")} <HelpTip>{t("ops.detail.contentHashHint")}</HelpTip>
      </dt>
      <dd>
        <code className="qcms-link-id" data-testid="qcms-content-hash">
          {detail.contentHash}
        </code>
      </dd>
      <dt>{t("ops.responses.column.flag")}</dt>
      <dd>{flagged === null ? t("ops.responses.flag.clean") : flagReasonText(flagged)}</dd>
    </dl>
  );
}

function Answers({
  detail,
  pins,
  labels,
}: {
  readonly detail: ResponseDetailData;
  readonly pins: readonly QuestionPin[];
  readonly labels: ReadonlyMap<string, string>;
}) {
  const keys = orderedAnswerKeys(detail.answers, pins);
  return (
    <section aria-labelledby="qcms-answers-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="qcms-answers-heading" className="text-base font-semibold text-(--color-text)">
          {t("ops.detail.answers")}
        </h2>
        <HelpTip>{t("ops.detail.answersIntro")}</HelpTip>
      </div>
      {keys.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-answers-empty">
          {t("ops.detail.noAnswer")}
        </p>
      ) : (
        <dl className="qcms-ops-summary" data-testid="qcms-locked-answers">
          {keys.map((questionId) => {
            const rendered = answerText(detail.answers[questionId]);
            return (
              <AnswerRow
                key={questionId}
                questionId={questionId}
                label={labelFor(labels, questionId)}
                rendered={rendered}
              />
            );
          })}
        </dl>
      )}
    </section>
  );
}

function AnswerRow({
  questionId,
  label,
  rendered,
}: {
  readonly questionId: string;
  readonly label: string;
  readonly rendered: string | null;
}) {
  return (
    <>
      <dt data-question-id={questionId}>{label}</dt>
      <dd>
        {rendered === null && (
          <span className="text-(--color-text-muted)">{t("ops.detail.noAnswer")}</span>
        )}
        {rendered === "" && (
          <span className="text-(--color-text-muted)">{t("ops.detail.emptyAnswer")}</span>
        )}
        {rendered !== null && rendered !== "" && rendered}
      </dd>
    </>
  );
}

function LedgerTimeline({
  detail,
  labels,
}: {
  readonly detail: ResponseDetailData;
  readonly labels: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-labelledby="qcms-ledger-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="qcms-ledger-heading" className="text-base font-semibold text-(--color-text)">
          {t("ops.detail.ledger")}
        </h2>
        <HelpTip>{t("ops.detail.ledgerIntro")}</HelpTip>
      </div>
      {detail.ledger.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-ledger-empty">
          {t("ops.detail.ledgerEmpty")}
        </p>
      ) : (
        <ol className="qcms-ledger" data-testid="qcms-ledger">
          {detail.ledger.map((entry, index) => {
            const rendered = answerText(entry.value);
            return (
              <li
                key={`${entry.questionId}-${String(index)}`}
                data-question-id={entry.questionId}
                data-retracted={entry.retracted ? "true" : "false"}
              >
                <span className="qcms-ledger-when">
                  <OperatorDateTime iso={entry.answeredAt} fallback={t("ops.common.none")} />
                </span>{" "}
                <span className="qcms-ledger-what">
                  {labelFor(labels, entry.questionId)}{" "}
                  {entry.retracted
                    ? t("ops.detail.ledgerRetracted")
                    : t("ops.detail.ledgerAnswered")}
                </span>{" "}
                {!entry.retracted && (
                  <span className="qcms-ledger-value">{rendered ?? t("ops.detail.noAnswer")}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
