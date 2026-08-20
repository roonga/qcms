"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Alert, Button, Dialog, Select, TextField } from "@/components/kit";
import { flagReasonText } from "@/components/ops/ops-tags";
import { TombstoneCard } from "@/components/ops/tombstone-card";
import { announce } from "@/lib/announce";
import { answerText } from "@/lib/ops/answers";
import type { ErasureReason } from "@/lib/ops/erasure";
import { DEFAULT_ERASURE_REASON, ERASURE_REASONS, isErasureConfirmed } from "@/lib/ops/erasure";
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
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/en";

/**
 * One response, with its audit ledger, its flag disposition and its erasure door
 * (task 035; wireframe "detail", "erasure").
 *
 * ## Two states, and the second one is the point
 *
 * Before erasure this renders the locked answers and the ledger. After it, the same
 * screen renders the **tombstone** and nothing else, because that is what remains
 * (ADR-17). It is one component rather than two routes so the transition is visible
 * where the operator performed it, and so there is no moment where the screen still
 * shows answers the database no longer holds.
 *
 * ## The ledger is a list, and it says what each entry did
 *
 * Chronology is carried in the text of each entry, not in the layout, so it survives
 * a screen reader linearising the page (the wireframe's a11y note). A retraction is
 * announced as "cleared" rather than rendered as an answer with no value: ADR-33
 * makes clearing an appended fact of its own, and flattening it would turn "the
 * respondent removed their answer" into "the respondent answered with nothing".
 */
export function ResponseDetail({
  detail,
  pins,
  labels,
  labelsFailed,
  linksHref,
  erase,
  unflag,
}: {
  readonly detail: ResponseDetailData;
  readonly pins: readonly QuestionPin[];
  readonly labels: ReadonlyMap<string, string>;
  /** True when the pinned wording could not be read, so captions are ids. */
  readonly labelsFailed: boolean;
  readonly linksHref: string;
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
  const [dialog, setDialog] = useState<"erase" | "unflag" | null>(null);
  const [released, setReleased] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Showing an outcome and announcing it are one event, never two, so neither path can
  // acquire a message the other does not have. The announcement goes to the shell's
  // live region rather than to the container below, because erasing revalidates this
  // route and the route unmounts this whole subtree a few hundred milliseconds later -
  // a region that leaves the document mid announcement says nothing (issue #355,
  // `lib/announce.ts`).
  const noteErasure = useCallback((message: string) => {
    setErasureNote(message);
    announce(message);
  }, []);
  const noteUnflag = useCallback((message: string) => {
    setUnflagNote(message);
    announce(message);
  }, []);

  // Both actions on this screen remove the button that opened their confirmation: the
  // erase button goes with the answers it belonged to, and the release button goes with
  // the whole flag panel. Focus is therefore placed deliberately (issue #308).
  //
  // The two land in different places because different things replaced them. After an
  // erasure the tombstone IS the post-action state, so its heading is where an operator
  // should be standing; its id is looked up rather than held in a ref because the card
  // is also rendered by the route on a later visit, and threading a ref through for one
  // of its two callers would put this screen's concern inside it. After a release
  // nothing replaces the panel, so the successor is the page's own heading, with the
  // outcome alert directly beneath it (the announcement of that outcome is made from
  // the shell's live region, not from here - issue #355). That heading now belongs to
  // the route's chrome rather than to this component (issue #510), so it is looked up
  // by id for the same reason the tombstone's is: a ref cannot reach out of the tree.
  useEffect(() => {
    if (tombstone === null) return undefined;
    requestPostActionFocus(TOMBSTONE_HEADING_ID);
    const settled = claimPostActionFocus(TOMBSTONE_HEADING_ID);
    return () => {
      settled?.();
      // Erasing revalidates this response's own route, and the route then renders the
      // SAME url as its own tombstone - which unmounts this subtree a few hundred
      // milliseconds after the focus above landed, dropping focus back to the body. So
      // re-arm on the way out: the card that replaces this one takes the request.
      requestPostActionFocus(TOMBSTONE_HEADING_ID);
    };
  }, [tombstone]);

  useEffect(() => {
    if (!released) return undefined;
    return focusPostAction(document.getElementById(RESPONSE_HEADING_ID));
  }, [released]);

  const runUnflag = useCallback(() => {
    startTransition(() => {
      void unflag(detail.sessionId)
        .then((state) => {
          if (state.status === "error") {
            noteUnflag(t("ops.detail.unflagFailed", { message: state.message ?? "" }));
            return;
          }
          // `released` distinguishes "this call released the withheld event" from "there
          // was nothing withheld", so the confirmation never claims the first for both.
          noteUnflag(
            state.released === true ? t("ops.detail.unflagged") : t("ops.detail.unflagNoop"),
          );
          setFlagged(null);
          setDialog(null);
          setReleased(true);
        })
        // `.catch` is not defensive decoration. `adminApiFetch` documents that it does not
        // throw for a non-2xx, which is true and is the trap: a transport failure still
        // rejects with a TypeError, and `readResult`'s `response.json()` rejects on a
        // truncated body. Without this the promise rejects unhandled, no state is set,
        // and the dialog sits there looking like a slow network forever.
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
          // The same trap as the other three call sites, and the worst place for it:
          // a silent failure here leaves an operator staring at a confirmed erasure
          // dialog with no idea whether an irreversible ADR-17 action ran (it did not).
          .catch(() => {
            noteErasure(t("ops.erase.failed", { message: unexpected() }));
          });
      });
    },
    [erase, detail.sessionId, noteErasure],
  );

  return (
    // Labelled by the route's own <h1>, which names this response (issue #510). The
    // heading is not repeated here: it was an <h2> saying exactly what the page heading
    // now says, and a page that states its subject twice at two levels is noise to
    // anyone reading the outline rather than the pixels.
    <section
      aria-labelledby={RESPONSE_HEADING_ID}
      className="flex flex-col gap-6"
      data-testid="qcms-response-detail"
    >
      {/* Deliberately NOT a live region (issue #355). It was one until an erasure was
          watched to the end: the action revalidates this route, the route re-renders the
          same url as its own tombstone, and this whole subtree unmounts a few hundred
          milliseconds later - taking the region and the sentence it had just been given.
          The announcement is made through `announce()` into the shell's region, which is
          above the page and survives that swap; these alerts stay here because what a
          sighted operator needs is the message beside the state that produced it. Two
          live regions holding the same sentence would say it twice. */}
      <div className="flex flex-col gap-2">
        {erasureNote !== "" && (
          <Alert variant={tombstone === null ? "error" : "success"}>{erasureNote}</Alert>
        )}
        {unflagNote !== "" && <Alert variant="info">{unflagNote}</Alert>}
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
              <Button
                variant="secondary"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setDialog("unflag");
                }}
              >
                {t("ops.detail.unflag")}
              </Button>
            </div>
          )}
          {labelsFailed && <Alert variant="warning">{t("ops.detail.labelsFailed")}</Alert>}
          <Answers detail={detail} pins={pins} labels={labels} />
          <LedgerTimeline detail={detail} labels={labels} />
          <div>
            <Button
              variant="danger"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                setDialog("erase");
              }}
            >
              {t("ops.erase.button")}
            </Button>
          </div>
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
          isPending={isPending}
          onConfirm={runErase}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/** Provenance: when, which version, how they got in, and the audit anchor. */
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
      <dd>{formatDateTime(detail.submittedAt, t("ops.common.none"))}</dd>
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
      <dt>{t("ops.detail.contentHash")}</dt>
      <dd>
        <code className="qcms-link-id" data-testid="qcms-content-hash">
          {detail.contentHash}
        </code>
        <span className="block text-(--color-text-muted)">{t("ops.detail.contentHashHint")}</span>
      </dd>
      <dt>{t("ops.responses.column.flag")}</dt>
      <dd>{flagged === null ? t("ops.responses.flag.clean") : flagReasonText(flagged)}</dd>
    </dl>
  );
}

/** The locked set, in document order, captioned with the pinned wording. */
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
      {/* h2, not h3: the response's own heading is the page's <h1> now (issue #510), so
          this section sits directly under it. Size is unchanged - the level is an outline
          fact, not a type scale. */}
      <h2 id="qcms-answers-heading" className="text-base font-semibold text-(--color-text)">
        {t("ops.detail.answers")}
      </h2>
      <p className="text-sm text-(--color-text-muted)">{t("ops.detail.answersIntro")}</p>
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

/**
 * One caption/value pair.
 *
 * An empty string and an absent value get different words: a question CAN be answered
 * with an empty string, and rendering both as blank would tell an operator the same
 * thing about two different facts.
 */
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

/**
 * The audit timeline: every revision, oldest first, exactly as `answerLedger` holds
 * it (exit criterion 4).
 *
 * An ordered list rather than a table, because the claim it makes is sequence: each
 * item states its own time, its own question and what happened to it, so nothing is
 * inferred from the row above.
 */
function LedgerTimeline({
  detail,
  labels,
}: {
  readonly detail: ResponseDetailData;
  readonly labels: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-labelledby="qcms-ledger-heading" className="flex flex-col gap-2">
      <h2 id="qcms-ledger-heading" className="text-base font-semibold text-(--color-text)">
        {t("ops.detail.ledger")}
      </h2>
      <p className="text-sm text-(--color-text-muted)">{t("ops.detail.ledgerIntro")}</p>
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
                // The ledger is append-only and can hold two revisions of one question
                // at the same recorded instant, so neither the question nor the time is
                // a key on its own; the position in an immutable, ordered list is.
                key={`${entry.questionId}-${String(index)}`}
                data-question-id={entry.questionId}
                data-retracted={entry.retracted ? "true" : "false"}
              >
                <span className="qcms-ledger-when">
                  {formatDateTime(entry.answeredAt, t("ops.common.none"))}
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

/**
 * The type-to-confirm erasure dialog (exit criterion 2).
 *
 * Three separate sentences before the input, and each is a distinct fact rather than
 * a rewording of "are you sure": what is deleted, what remains, and what is NOT
 * affected. The third exists because it is the question an operator actually has at
 * this moment - a consumer already holds the submission, and no erasure here can
 * reach it. Saying so is more honest than leaving it to be assumed either way.
 *
 * The confirm button is disabled until the typed text matches the session id exactly,
 * which is `isErasureConfirmed` and is unit-tested against the same string this
 * dialog puts on screen.
 */
function EraseDialog({
  sessionId,
  isPending,
  onConfirm,
  onClose,
}: {
  readonly sessionId: string;
  readonly isPending: boolean;
  readonly onConfirm: (reason: ErasureReason) => void;
  readonly onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState<ErasureReason>(DEFAULT_ERASURE_REASON);
  const confirmed = isErasureConfirmed(typed, sessionId);

  return (
    <Dialog
      isOpen
      role="alertdialog"
      title={t("ops.erase.title")}
      isDismissable={!isPending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <div className="flex flex-col gap-4" data-testid="qcms-erase-dialog">
        <p className="text-sm text-(--color-text)">{t("ops.erase.irreversible")}</p>
        <p className="text-sm text-(--color-text)">{t("ops.erase.tombstoneStays")}</p>
        <p className="text-sm text-(--color-text)">{t("ops.erase.consumersUnaffected")}</p>
        <Select
          label={t("ops.erase.reason")}
          value={reason}
          items={ERASURE_REASONS.map((entry) => ({
            label: t(`ops.erase.reason.${entry}`),
            value: entry,
          }))}
          onChange={(next) => {
            setReason(next as ErasureReason);
          }}
        />
        <TextField
          label={t("ops.erase.confirmLabel")}
          description={t("ops.erase.confirmHint", { sessionId })}
          value={typed}
          isInvalid={typed !== "" && !confirmed}
          errorMessage={t("ops.erase.mismatch")}
          onChange={setTyped}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            size="md"
            isDisabled={!confirmed || isPending}
            onPress={() => {
              onConfirm(reason);
            }}
          >
            {isPending ? t("ops.common.working") : t("ops.erase.confirm")}
          </Button>
          <Button variant="ghost" size="md" isDisabled={isPending} onPress={onClose}>
            {t("ops.common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
