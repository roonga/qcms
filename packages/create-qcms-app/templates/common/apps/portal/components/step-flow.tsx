"use client";

import { A2UIStepRenderer, expandRepeatGroups } from "@roonga/qcms-ui";
import type { A2UIAnswerValue, A2UIErrors, A2UIStepDocument, A2UIValues } from "@roonga/qcms-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { HydrationMarker } from "@/components/hydration-marker";
import { useAppLocale } from "@/components/locale-context";
import { PortalShell } from "@/components/portal-shell";
import {
  diffFlow,
  cssEscape,
  focusQuestion,
  nextFocusTargetAfterRemoval,
  questionIdOf,
  type FlowDelta,
  type FlowView,
} from "@/lib/a11y";
import {
  answerKey,
  commitsOnFocusExit,
  holdsAnswer,
  isRecorded,
  recordedAnswers,
  visibleErrors,
  withConfirmed,
  withIssued,
  withRejection,
  withRollback,
  withServerHeld,
  withoutRejection,
  type PostedRecord,
  type RejectedAnswers,
} from "@/lib/answer-record";
import { missingOnStep, refusalsOnStep, stepSummaryEntries } from "@/lib/error-summary";
import {
  countRefusalAfterSuccess,
  failureAfterSuccess,
  refusalOutcome,
  type FlowFailure,
  type FlowSuccess,
  type RefusalOutcome,
} from "@/lib/flow-outcome";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";
import {
  authorMessageFor,
  defaultAnswerMessage,
  errorCodeOf,
  errorDetailsOf,
  firstAnswerRejection,
} from "@/lib/validation-message";
import {
  commitMoments,
  documentForVisible,
  messagesOf,
  DEFAULT_COMMIT_MOMENT,
} from "@/lib/visible";
import { rosterMap } from "@/lib/rosters";
import {
  focusAfterAdd,
  focusAfterRemoval,
  instanceLabelTemplates,
  resolvedInstanceLabel,
  viewInstanceLabel,
  viewNarrowing,
} from "@/lib/repeat";
import type { CommitMoment } from "@/lib/visible";
import type { RosterOpResponse, StepResponse } from "@/lib/server/api";

async function readJsonSafely(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * The typed code is read as well as the status because the not-visible refusal shares
 * the 409 with the terminal ones. The body is read once here: two predicates that each
 * read it left the second reading a consumed body.
 */
async function readRefusal(res: Response): Promise<RefusalOutcome> {
  return refusalOutcome(res.status, errorCodeOf(await readJsonSafely(res)));
}

type RoundTrip = "ok" | "failed" | "leaving";

/**
 * A count refusal (ADR-42) has no field to hang a message on, so without this branch a
 * blocked Submit draws an empty error summary and says nothing.
 */
function isCountRefusal(details: unknown): boolean {
  if (typeof details !== "object" || details === null) return false;
  const errors = (details as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { code?: unknown }).code === "REPEAT_COUNT_OUT_OF_RANGE",
  );
}

function branchAnnouncement(added: readonly string[], removed: readonly string[]): string {
  if (added.length > 0) {
    return added.length === 1
      ? t("announce.branchAdded.one")
      : t("announce.branchAdded.other", { count: added.length });
  }
  if (removed.length > 0) {
    return removed.length === 1
      ? t("announce.branchRemoved.one")
      : t("announce.branchRemoved.other", { count: removed.length });
  }
  return "";
}

const flowViewOf = (snapshot: StepResponse): FlowView => ({
  // The rendered step, not `flowState.currentStep`, which is the derived
  // first-incomplete step and may differ (ADR-28).
  stepId: snapshot.step?.stepId ?? null,
  // Two views of one paginated step share a step id, so without the instance a Continue
  // between them would be no navigation at all.
  instanceId: snapshot.view.instanceId,
  stepIndex: snapshot.progress.stepIndex,
  visibleQuestions: snapshot.flowState.visibleQuestions,
});

// Priority order: a step change, then becoming ready, then a branch count.
function announcementText(
  delta: FlowDelta,
  becameReady: boolean,
  stepIndex: number,
  total: number,
  headingText: string | undefined,
  /**
   * True when the progress indicator's own polite region already names this page, in
   * which case the step-change sentence is suppressed here or a screen reader says it
   * twice on every Continue.
   */
  namedByIndicator: boolean,
): string {
  if (delta.stepChanged) {
    // Silent rather than falling through: a move between two views of one step changes
    // the whole visible set, which the branch case below would report as an insertion.
    if (namedByIndicator) return "";
    const current = stepIndex + 1;
    return headingText
      ? t("announce.stepChange", { current, total, title: headingText })
      : t("announce.stepChangeNoTitle", { current, total });
  }
  if (becameReady) return t("announce.ready");
  return branchAnnouncement(delta.added, delta.removed);
}

/**
 * The within-step focus policy, for the cases where focus would otherwise fall to
 * `<body>`. A branch insert keeps focus on the answered control, and step navigation is
 * handled separately, so both are no-ops here.
 */
function recoverFocus(args: {
  readonly container: HTMLElement | null;
  readonly focused: string;
  readonly delta: FlowDelta;
  readonly previousVisible: readonly string[];
  readonly nextVisible: ReadonlySet<string>;
}): void {
  const focusLost = document.activeElement === null || document.activeElement === document.body;
  const { container } = args;
  if (container === null) return;
  if (args.delta.removed.includes(args.focused)) {
    const target = nextFocusTargetAfterRemoval(
      args.previousVisible,
      args.focused,
      args.nextVisible,
    );
    if (target !== undefined && focusQuestion(container, target)) return;
    const heading = container.querySelector<HTMLElement>("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  } else if (args.nextVisible.has(args.focused) && focusLost) {
    focusQuestion(container, args.focused);
  }
}

/**
 * A whole sentence and never a changing number: WCAG 4.1.3's own Understanding warns
 * that updating only the digit in "3 items" can announce just "three". A removed
 * instance is named from the roster as it was before the removal, which is the only
 * place its ordinal still exists, and a label-less instance names its group rather than
 * an opaque `ins_` id.
 */
function rosterAnnouncement(input: {
  readonly op: "add" | "remove";
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly instanceId: string | undefined;
  readonly templates: ReadonlyMap<string, string>;
  readonly groupId: string;
}): string {
  const { op, before, after, instanceId, templates, groupId } = input;
  if (op === "add") {
    const added = after.find((id) => !before.includes(id));
    const label =
      added === undefined ? undefined : resolvedInstanceLabel(templates, groupId, after, added);
    return t("repeat.added", { label: label ?? groupId });
  }
  const label =
    instanceId === undefined
      ? undefined
      : resolvedInstanceLabel(templates, groupId, before, instanceId);
  const named = label ?? groupId;
  return after.length === 0
    ? t("repeat.removedLast", { label: named })
    : t("repeat.removed", { label: named, count: after.length });
}

function ActionNotices({
  failure,
  countRefused,
  onRetry,
}: {
  readonly failure: { readonly seq: number } | undefined;
  readonly countRefused: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <>
      {failure !== undefined ? (
        <div
          // Keyed by sequence, so a second failure is a fresh alert and is announced
          // again rather than being an unchanged node.
          key={failure.seq}
          data-testid="flow-failure"
          className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-4"
        >
          <p role="alert" className="text-sm text-(--color-danger-fg)">
            {t("session.lost.body")}
          </p>
          <button
            type="button"
            className={buttonClass("secondary")}
            onClick={onRetry}
            data-testid="retry-action"
          >
            {t("action.retry")}
          </button>
        </div>
      ) : null}
      {countRefused ? (
        <p role="alert" data-testid="count-refusal" className="text-sm text-(--color-danger-fg)">
          {t("repeat.countOutOfRange")}
        </p>
      ) : null}
    </>
  );
}

export function StepFlow({
  sessionId,
  initial,
  basePath,
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
  /**
   * A prop and not a derivation: a client component cannot read the request header the
   * proxy resolved the environment on, and parsing `window.location` would make every
   * address below depend on the one the browser happens to be at (Q21).
   */
  readonly basePath: string;
}) {
  const [snapshot, setSnapshot] = useState<StepResponse>(initial);
  // Seeded from the answers the server already holds, or a resumed step renders empty
  // over answers the server has. Display state only: visibility and the Continue gate
  // stay the API's (R2).
  const [values, setValues] = useState<A2UIValues>(initial.values);
  const locale = useAppLocale();
  // Which value the API refused per question. The displayed errors are derived from that
  // plus the values on screen, so a message lives exactly as long as the value it
  // describes.
  const [rejected, setRejected] = useState<RejectedAnswers>({});
  // The same refusals, readable from a queued callback: the Continue gate runs behind any
  // answer post the click itself caused and must see what that post recorded.
  const rejectedRef = useRef<RejectedAnswers>(rejected);
  const errors: A2UIErrors = useMemo(() => visibleErrors(rejected, values), [rejected, values]);
  // Focus moves to the summary on the counter's bump and on nothing else: its entries
  // change as the respondent corrects fields, and following that would pull them out of
  // the field they are typing in.
  const [showSummary, setShowSummary] = useState(false);
  const [summaryRequest, setSummaryRequest] = useState(0);
  // The sequence number keys the alert, so a second failure of the same operation is a
  // new node and is announced again.
  const [failure, setFailure] = useState<
    { readonly op: FlowFailure; readonly seq: number } | undefined
  >(undefined);
  // The guard refuses a second navigation while one is pending, which is what keeps a
  // double press from advancing or submitting twice. The ref is the guard, because a
  // gesture is not a render away; the state draws it.
  const intentRef = useRef(false);
  const [intentPending, setIntentPending] = useState(false);
  // Set once the page is being replaced. Nothing queued after that runs, so a late press
  // cannot race the navigation away.
  const leavingRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const [busyGroup, setBusyGroup] = useState<string | undefined>(undefined);
  const [rosterStatus, setRosterStatus] = useState<
    { readonly groupId: string; readonly message: string } | undefined
  >(undefined);
  const [pendingFocus, setPendingFocus] = useState<string | undefined>(undefined);
  const valuesRef = useRef<A2UIValues>(values);
  valuesRef.current = values;
  // Updated only where the snapshot changes, never on every render: a render-time
  // reassignment could clobber a fresh server response with stale state from an
  // interleaved re-render, making a just-completed answer look unfinished.
  const snapshotRef = useRef<StepResponse>(snapshot);
  // Answer posts and navigations are serialized on one queue: a follow-up answer must
  // not overtake the answer that made its question visible, and a Continue must evaluate
  // its gate only after any in-flight answer has landed.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // What the server is known to hold per question, so a blur does not re-post what a
  // change already posted. The rules live in `lib/answer-record.ts`; the ref holds it
  // because a commit moment must see the write the one before it made, which is a
  // gesture away, not a render away.
  const lastPostedRef = useRef<PostedRecord>(recordedAnswers(initial.values));
  // A second record rather than a reading of the first, because the first deliberately
  // holds in-flight values: with two overlapping refusals of one question, the second
  // post's predecessor in the optimistic record is the first post's refused value.
  const confirmedRef = useRef<PostedRecord>(recordedAnswers(initial.values));
  const rosters = useMemo(() => rosterMap(snapshot.rosters), [snapshot.rosters]);
  const view = useMemo(() => viewNarrowing(snapshot.view), [snapshot.view]);
  // Expanded here rather than left to the renderer because the commit moments and the
  // error summary have to key on the same post-expansion field names.
  const expandedStep = useMemo<A2UIStepDocument | null>(() => {
    const step = snapshot.step as unknown as A2UIStepDocument | null;
    if (step === null) return null;
    return {
      stepId: step.stepId,
      root: expandRepeatGroups(step.root, { rosters, ...(view !== undefined ? { view } : {}) }),
    };
  }, [snapshot.step, rosters, view]);
  const moments = useMemo(
    () =>
      expandedStep === null
        ? (new Map() as ReadonlyMap<string, CommitMoment>)
        : commitMoments(expandedStep),
    [expandedStep],
  );

  const fieldsRef = useRef<HTMLDivElement>(null);
  const prevFlowRef = useRef<FlowView | undefined>(undefined);
  const focusedAtUpdateRef = useRef<string | undefined>(undefined);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [countRefused, setCountRefused] = useState(false);
  const prevReadyRef = useRef<boolean>(initial.flowState.readyToSubmit);

  // Keeps the ref the queued gate reads in step with the state.
  const updateRejected = useCallback(
    (update: (previous: RejectedAnswers) => RejectedAnswers): void => {
      rejectedRef.current = update(rejectedRef.current);
      setRejected(rejectedRef.current);
    },
    [],
  );

  const reportFailure = useCallback((op: FlowFailure): void => {
    setFailure((previous) => ({ op, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  // Drops the notices a successful round trip makes stale, or they sit on the card for
  // the rest of a session that is saving normally.
  const noteSuccess = useCallback((success: FlowSuccess): void => {
    setFailure((previous) =>
      failureAfterSuccess(previous?.op, success) === undefined ? undefined : previous,
    );
    setCountRefused((previous) => countRefusalAfterSuccess(previous, success));
  }, []);

  // The page's server render owns the screen for a terminal refusal, so the wording for
  // each lives in one place rather than drifting between the two transports.
  const reloadFlow = useCallback((): void => {
    leavingRef.current = true;
    window.location.assign(`${basePath}/s/${encodeURIComponent(sessionId)}`);
  }, [basePath, sessionId]);

  // Returns whether the API accepted the answer, which is what decides whether the
  // optimistic record entry stands or is rolled back.
  const sendAnswer = useCallback(
    async (name: string, value: A2UIAnswerValue | undefined): Promise<boolean> => {
      try {
        const res = await fetch(`${basePath}/s/${encodeURIComponent(sessionId)}/answers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The committed cursor, so the API re-renders this step rather than advancing
          // as a side effect of answering (ADR-28).
          body: JSON.stringify({
            questionId: name,
            value: value ?? null,
            step: snapshotRef.current.progress.stepIndex,
          }),
        });
        if (res.status === 200) {
          const next = (await res.json()) as StepResponse;
          // The record is not written here: `postAnswer` wrote it at issue time, and
          // writing it again would clobber a newer commit of the same question made
          // while this post was in flight.
          //
          // Which question holds focus now, so the post-render effect can recover it if
          // this projection removes it.
          focusedAtUpdateRef.current = questionIdOf(document.activeElement);
          // Synchronously, not only via the render, so a queued navigation chained right
          // after this post reads fresh state.
          snapshotRef.current = next;
          setSnapshot(next);
          // The refused value is no longer what the server holds, so its message can
          // never apply again even if the respondent re-enters that value.
          updateRejected((prev) => withoutRejection(prev, name));
          noteSuccess({ kind: "answer", questionId: name });
          return true;
        }
        if (res.status === 422) {
          // The author's own wording for the constraint that failed, if there is one
          // (ADR-32), then the same `defaultAnswerMessage` resolution the no-JS route
          // uses. Reaching for the generic catalogue entry here directly is what made a
          // hydrated respondent's message vaguer than a JavaScript-disabled one.
          const rejection = firstAnswerRejection(errorDetailsOf(await readJsonSafely(res)));
          const authored = authorMessageFor(
            messagesOf(snapshotRef.current.step as unknown as A2UIStepDocument | null).get(name),
            rejection?.constraint,
          );
          const message = authored ?? defaultAnswerMessage(rejection, t("answer.invalid"));
          updateRejected((prev) => withRejection(prev, name, value, message));
          // The server answered about this question, so a notice saying it could not be
          // reached is no longer true of it.
          noteSuccess({ kind: "answer", questionId: name });
          return false;
        }
        const outcome = await readRefusal(res);
        if (outcome === "reload") {
          reloadFlow();
          return false;
        }
        if (outcome === "notVisible") {
          // This client posted a control the current projection has already hidden, so
          // adopting that projection is the honest answer rather than claiming the
          // server could not be reached.
          //
          // At the committed cursor, never the first incomplete step: a cursor-less read
          // would move the page because an answer was posted, which ADR-28 forbids.
          const at = snapshotRef.current.progress.stepIndex;
          if ((await doNavigate(at)) === "failed") reportFailure({ kind: "refresh" });
          return false;
        }
        reportFailure({ kind: "answer", questionId: name });
        return false;
      } catch {
        reportFailure({ kind: "answer", questionId: name });
        return false;
      }
    },
    [sessionId],
  );

  /**
   * The single funnel every commit moment posts through, and the owner of the record of
   * what the server has.
   *
   * The record is written before the request is queued, because the next commit moment
   * for the same question can arrive before this post resolves: a `change` control's
   * post is still in flight while focus is leaving it, and the blur that follows must
   * see the value as recorded or it re-posts it. It is rolled back if the post is not
   * accepted, so a refused value stays retryable.
   */
  const postAnswer = useCallback(
    (name: string, value: A2UIAnswerValue | undefined): void => {
      // Already recorded, or a post carrying it is in flight: re-posting is a redundant
      // append that also queues a round trip ahead of the advance guard.
      if (isRecorded(lastPostedRef.current, name, value)) return;
      const key = answerKey(value);
      lastPostedRef.current = withIssued(lastPostedRef.current, name, value);
      queueRef.current = queueRef.current.then(async () => {
        if (leavingRef.current) return;
        const accepted = await sendAnswer(name, value);
        if (accepted) {
          confirmedRef.current = withConfirmed(confirmedRef.current, name, value);
          return;
        }
        // The predecessor is read here rather than at issue time, and out of the
        // confirmed record rather than the optimistic one: the queue is serial, so by now
        // every earlier post for this question has resolved.
        lastPostedRef.current = withRollback(
          lastPostedRef.current,
          confirmedRef.current,
          name,
          key,
        );
      });
    },
    [sendAnswer],
  );

  /**
   * The Add or Remove on the scripted path (ADR-43). It writes no answer, because every
   * answer here has already been committed at its own commit moment, and it rides the
   * same serial queue so it cannot overtake an in-flight commit.
   *
   * Focus and the announcement are decided here rather than by the renderer, because
   * they are properties of what just happened rather than of what is on screen, and the
   * destination is computed from the roster before the operation, which is the only
   * place the removed instance's position exists (Q11).
   */
  const applyRosterOp = useCallback(
    (op: "add" | "remove", groupId: string, instanceId: string | undefined): void => {
      const before = rosterMap(snapshotRef.current.rosters)[groupId] ?? [];
      // Read from the view the respondent pressed on, never the one the operation
      // returns: an empty paginated roster projects `view.groupId: null`, so the
      // post-operation view would withhold the focus destination for the one case where
      // the new instance is drawn on the page it was added from.
      const paginatedBefore = snapshotRef.current.view.groupId === groupId;
      setBusyGroup(groupId);
      queueRef.current = queueRef.current.then(async () => {
        if (leavingRef.current) return;
        try {
          const res = await fetch(`${basePath}/s/${encodeURIComponent(sessionId)}/roster`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              op,
              groupId,
              ...(instanceId !== undefined ? { instanceId } : {}),
              step: snapshotRef.current.progress.stepIndex,
            }),
          });
          if (res.status !== 200) {
            // "Try again" is as untrue for a roster write as it is for an answer.
            if ((await readRefusal(res)) === "reload") {
              reloadFlow();
              return;
            }
            setRosterStatus({ groupId, message: t("repeat.failed") });
            return;
          }
          const next = (await res.json()) as RosterOpResponse;
          snapshotRef.current = next;
          setSnapshot(next);
          noteSuccess({ kind: "roster" });
          const after = rosterMap(next.rosters)[groupId] ?? [];
          const templates = instanceLabelTemplates(next.step as unknown as A2UIStepDocument | null);
          setRosterStatus({
            groupId,
            message: rosterAnnouncement({ op, before, after, instanceId, templates, groupId }),
          });
          // An add on a paginated group has no destination: the new instance is a view
          // one page further along, and only Continue, Back and Submit may move the
          // rendered page (ADR-28). After a removal the API's clamp of the committed
          // cursor already produces Q11's three destinations.
          setPendingFocus(
            op === "add"
              ? focusAfterAdd(next.minted, groupId, paginatedBefore)
              : focusAfterRemoval(before, instanceId ?? "", groupId),
          );
        } catch {
          setRosterStatus({ groupId, message: t("repeat.failed") });
        } finally {
          setBusyGroup(undefined);
        }
      });
    },
    [sessionId],
  );

  const addInstance = useCallback(
    (groupId: string): void => {
      applyRosterOp("add", groupId, undefined);
    },
    [applyRosterOp],
  );

  const removeInstance = useCallback(
    (groupId: string, instanceId: string): void => {
      applyRosterOp("remove", groupId, instanceId);
    },
    [applyRosterOp],
  );

  const handleChange = useCallback(
    (name: string, value: A2UIAnswerValue | undefined): void => {
      setValues((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[name];
        else next[name] = value;
        return next;
      });
      // ADR-31's commit moment. The moment comes from the compiled document because the
      // value alone cannot separate a singleChoice OptionId from a date or a long-text
      // string, and a change mid-entry is a keystroke rather than an answer.
      const moment = moments.get(name) ?? DEFAULT_COMMIT_MOMENT;
      if (moment === "change") {
        postAnswer(name, value);
        return;
      }
      // A previously answered `completion` control posts its ADR-33 retraction here:
      // the adapter surfaces the clear with no blur behind it, so this change event is
      // the commit moment. A never-answered clear is not an answer and posts nothing.
      if (
        moment === "completion" &&
        value === undefined &&
        holdsAnswer(lastPostedRef.current, name)
      ) {
        postAnswer(name, value);
      }
    },
    [moments, postAnswer],
  );

  /**
   * The renderer calls this only when focus leaves the whole control, which is exactly
   * ADR-31's `groupExit` for a multiChoice as well as the `blur` and `completion`
   * commits. Whether an empty control commits anything is `commitsOnFocusExit`, which
   * carries the rules.
   */
  const handleBlur = useCallback(
    (name: string): void => {
      const value = valuesRef.current[name];
      const moment = moments.get(name) ?? DEFAULT_COMMIT_MOMENT;
      if (!commitsOnFocusExit(lastPostedRef.current, name, value, moment)) return;
      postAnswer(name, value);
    },
    [moments, postAnswer],
  );

  const requestSummary = useCallback((): void => {
    setShowSummary(true);
    setSummaryRequest((count) => count + 1);
  }, []);

  const doSubmit = useCallback(async (): Promise<RoundTrip> => {
    try {
      const res = await fetch(`${basePath}/s/${encodeURIComponent(sessionId)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        const body = (await res.json()) as { redirect?: string };
        leavingRef.current = true;
        window.location.assign(body.redirect ?? `${basePath}/done`);
        return "leaving";
      }
      if (res.status === 422) {
        noteSuccess({ kind: "submitRefused" });
        // A count refusal has no field to show a message beside, so it gets a
        // page-level one.
        setCountRefused(isCountRefusal(errorDetailsOf(await readJsonSafely(res))));
        requestSummary();
        return "ok";
      }
      if ((await readRefusal(res)) === "reload") {
        reloadFlow();
        return "leaving";
      }
      return "failed";
    } catch {
      return "failed";
    }
  }, [sessionId]);

  /**
   * `target === "current"` asks for the first incomplete step.
   *
   * Held answers are merged over the displayed values rather than swapped in, so a key
   * the server has wins and a value this client is still carrying is never dropped. The
   * adoption happens here and not on an answer post's response, which returns the same
   * projection: a post lands while the respondent may be typing in another
   * already-answered control, and adopting there would overwrite what they just typed.
   */
  const doNavigate = useCallback(
    async (target: number | "current"): Promise<RoundTrip> => {
      try {
        const query = target === "current" ? "" : `?step=${encodeURIComponent(String(target))}`;
        const res = await fetch(`${basePath}/s/${encodeURIComponent(sessionId)}/step${query}`);
        if (res.status === 200) {
          const next = (await res.json()) as StepResponse;
          // Navigation lands focus on the new step's heading, so no per-question
          // recovery is requested.
          focusedAtUpdateRef.current = undefined;
          snapshotRef.current = next;
          setValues((prev) => ({ ...prev, ...next.values }));
          lastPostedRef.current = withServerHeld(lastPostedRef.current, next.values);
          confirmedRef.current = withServerHeld(confirmedRef.current, next.values);
          setSnapshot(next);
          noteSuccess({ kind: "navigation" });
          return "ok";
        }
        if ((await readRefusal(res)) === "reload") {
          reloadFlow();
          return "leaving";
        }
        return "failed";
      } catch {
        return "failed";
      }
    },
    [sessionId],
  );

  /**
   * The press is queued the moment it lands, whatever is saving, so it is never lost;
   * and while one intent is pending a second press is refused here, so a double click
   * advances one step and a Submit posts once.
   */
  const runIntent = useCallback((intent: () => Promise<void>): void => {
    if (intentRef.current || leavingRef.current) return;
    intentRef.current = true;
    setIntentPending(true);
    queueRef.current = queueRef.current.then(async () => {
      try {
        if (!leavingRef.current) await intent();
      } finally {
        if (!leavingRef.current) {
          intentRef.current = false;
          setIntentPending(false);
        }
      }
    });
  }, []);

  /**
   * A re-opened earlier required question sends the respondent to the first incomplete
   * step as an explicit action, never a silent backward jump.
   *
   * A field showing a refusal blocks Continue and Submit on any step: the server holds
   * something other than what the respondent is looking at, so moving on would leave the
   * step with an answer they believe they gave and the ledger does not have (ADR-28).
   */
  const attemptAdvance = useCallback((): void => {
    runIntent(async () => {
      const snap = snapshotRef.current;
      const index = snap.progress.stepIndex;
      const total = snap.progress.totalVisibleSteps;
      const stepQuestions = new Set(snap.flowState.visibleQuestions);
      const stepMissing = snap.flowState.missingRequired.filter((q) => stepQuestions.has(q));
      const refusals = refusalsOnStep(
        visibleErrors(rejectedRef.current, valuesRef.current),
        snap.flowState.visibleQuestions,
      );
      if (stepMissing.length > 0 || Object.keys(refusals).length > 0) {
        requestSummary();
        return;
      }

      if (index >= total - 1) {
        if (snap.flowState.readyToSubmit) {
          if ((await doSubmit()) === "failed") reportFailure({ kind: "advance" });
          return;
        }
        const read = await doNavigate("current");
        if (read === "failed") reportFailure({ kind: "advance" });
        if (read === "ok") requestSummary();
        return;
      }
      setShowSummary(false);
      if ((await doNavigate(index + 1)) === "failed") reportFailure({ kind: "advance" });
    });
  }, [doNavigate, doSubmit]);

  const goBack = useCallback((): void => {
    runIntent(async () => {
      const index = snapshotRef.current.progress.stepIndex;
      if (index <= 0) return;
      setShowSummary(false);
      if ((await doNavigate(index - 1)) === "failed") reportFailure({ kind: "back" });
    });
  }, [doNavigate]);

  /**
   * An answer is re-committed from the value on screen through the ordinary funnel, so
   * the dedupe and rollback rules apply as they do to any commit; a navigation re-runs
   * the press through the same guard as the button.
   */
  const retryFailure = useCallback((): void => {
    const op = failure?.op;
    if (op === undefined) return;
    setFailure(undefined);
    switch (op.kind) {
      case "answer": {
        const value = valuesRef.current[op.questionId];
        if (value === undefined && !holdsAnswer(lastPostedRef.current, op.questionId)) return;
        postAnswer(op.questionId, value);
        return;
      }
      case "advance":
        attemptAdvance();
        return;
      case "back":
        goBack();
        return;
      case "refresh":
        runIntent(async () => {
          const at = snapshotRef.current.progress.stepIndex;
          if ((await doNavigate(at)) === "failed") reportFailure({ kind: "refresh" });
        });
        return;
    }
  }, [failure, postAnswer, attemptAdvance, goBack, runIntent, doNavigate, reportFailure]);

  const stepIndex = snapshot.progress.stepIndex;
  const total = snapshot.progress.totalVisibleSteps;
  const isFirstStep = stepIndex <= 0;
  const isFinalStep = stepIndex >= total - 1;
  const viewLabel = viewInstanceLabel(
    instanceLabelTemplates(snapshot.step as unknown as A2UIStepDocument | null),
    rosters,
    snapshot.view,
  );
  const progress = {
    current: stepIndex + 1,
    total,
    ...(viewLabel === undefined ? {} : { label: viewLabel }),
  };
  const primaryLabel = isFinalStep ? t("action.submit") : t("action.continue");
  // Absent rather than `false` when nothing is pending, so the markup is unchanged then.
  const pendingAttr = intentPending ? true : undefined;

  // Each entry has to name its own question for the summary links to have distinct
  // accessible names (WCAG 3.3.1), so the visible set travels with the call to name a
  // label-less question by position, and the document is the expanded one: only the
  // expanded tree carries nodes under a repeated question's qualified name, so the
  // stored tree would name neither the question nor its instance.
  const stepVisibleQuestions = snapshot.flowState.visibleQuestions;
  const stepRefusals = refusalsOnStep(errors, stepVisibleQuestions);
  const summaryEntries = showSummary
    ? stepSummaryEntries(
        expandedStep,
        stepRefusals,
        missingOnStep(snapshot.flowState.missingRequired, stepVisibleQuestions, stepRefusals),
        stepVisibleQuestions,
      )
    : [];
  const summaryCountRef = useRef(0);
  summaryCountRef.current = summaryEntries.length;

  // The SSR first paint needs neither announcement nor focus move, so the diff against
  // `prevFlowRef` is empty on mount and this becomes active from the first action.
  useEffect(() => {
    const container = fieldsRef.current;
    const previous = prevFlowRef.current;
    const next = flowViewOf(snapshot);
    const delta = diffFlow(previous, next);
    prevFlowRef.current = next;

    const ready = snapshot.flowState.readyToSubmit;
    const becameReady = previous !== undefined && !prevReadyRef.current && ready;
    prevReadyRef.current = ready;

    const headingText = container?.querySelector("h1, h2")?.textContent?.trim() || undefined;
    setAnnouncement(
      announcementText(
        delta,
        becameReady,
        next.stepIndex,
        snapshot.progress.totalVisibleSteps,
        headingText,
        viewLabel !== undefined,
      ),
    );

    // A different step lands focus at its heading, so keyboard and screen-reader users
    // start at the top of it.
    if (delta.stepChanged && previous !== undefined) {
      const heading = container?.querySelector<HTMLElement>("h1, h2");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
      focusedAtUpdateRef.current = undefined;
      return;
    }

    const focused = focusedAtUpdateRef.current;
    focusedAtUpdateRef.current = undefined;
    if (focused === undefined) return;
    recoverFocus({
      container,
      focused,
      delta,
      previousVisible: previous?.visibleQuestions ?? [],
      nextVisible: new Set(next.visibleQuestions),
    });
  }, [snapshot]);

  // Keyed on the press alone (WCAG 3.3.1): the entries change as the respondent corrects
  // fields, and moving focus on that would pull them out of the field they are in.
  useEffect(() => {
    if (summaryRequest > 0 && summaryCountRef.current > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [summaryRequest]);

  /**
   * Separate from the flow-diff effect above because a roster change is not a flow
   * change, and run after the render because the heading of an instance added a moment
   * ago is not in the DOM until this projection has painted (Q11).
   */
  useEffect(() => {
    if (pendingFocus === undefined) return;
    setPendingFocus(undefined);
    const container = fieldsRef.current;
    const target = container?.querySelector<HTMLElement>(`[id="${cssEscape(pendingFocus)}"]`);
    target?.focus();
  }, [pendingFocus, snapshot]);

  const focusMissingField = useCallback(
    (questionId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (fieldsRef.current) focusQuestion(fieldsRef.current, questionId);
    },
    [],
  );

  return (
    <PortalShell progress={progress}>
      {/* Mounted on the controlled flow rather than in `PortalShell`, which `NativeStep`
          also uses: a marker there would be stamped during the very window the e2e wait
          exists to close. */}
      <HydrationMarker />
      <div className="flex flex-col gap-6">
        {/* Always present so screen readers register it; visually hidden because the
            change it announces is already on screen. */}
        <div aria-live="polite" className="sr-only" data-testid="flow-announcer">
          {announcement}
        </div>

        {summaryEntries.length > 0 ? (
          <div
            ref={errorSummaryRef}
            role="alert"
            tabIndex={-1}
            aria-labelledby="error-summary-title"
            data-testid="error-summary"
            className="rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-4 outline-none"
          >
            <p id="error-summary-title" className="text-sm font-medium text-(--color-danger-fg)">
              {t("errorSummary.title")}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {summaryEntries.map((entry) => (
                <li key={entry.questionId}>
                  <a
                    href={`#${entry.questionId}`}
                    onClick={focusMissingField(entry.questionId)}
                    className="text-sm text-(--color-danger-fg) underline"
                  >
                    {entry.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {snapshot.step !== null ? (
          <div ref={fieldsRef}>
            <A2UIStepRenderer
              document={documentForVisible(
                expandedStep as A2UIStepDocument,
                snapshot.flowState.visibleQuestions,
              )}
              values={values}
              errors={errors}
              onChange={handleChange}
              onBlur={handleBlur}
              repeat={{
                rosters,
                ...(view !== undefined ? { view } : {}),
                visible: new Set(snapshot.flowState.visibleQuestions),
                onAdd: addInstance,
                onRemove: removeInstance,
                ...(rosterStatus !== undefined ? { status: rosterStatus } : {}),
                ...(busyGroup !== undefined ? { busyGroupId: busyGroup } : {}),
              }}
              // Feeds react-aria's `I18nProvider`, so it decides the date field's
              // segment order. The no-JS view passes the same tag, so the order does not
              // change at hydration.
              locale={locale}
              specVersion={snapshot.a2uiSpecVersion}
            />
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-(--color-text-muted)">
            {t("flow.submitReady")}
          </p>
        )}

        {/* Beside the actions that caused them rather than at the top of the card: on a
            phone the top of the card is usually scrolled away from the button the
            respondent just pressed, so a notice there was announced and never seen. */}
        <ActionNotices failure={failure} countRefused={countRefused} onRetry={retryFailure} />

        {/* `aria-disabled` and not `disabled`: a disabled button swallows the click that
            lands while the blur's post is in flight, which is the first click after
            typing. The press is queued instead, and `runIntent` refuses a second. */}
        <div className="flex items-center justify-between gap-3 pt-2">
          {isFirstStep ? (
            // A spacer, so the primary action stays right-aligned without Back.
            <span aria-hidden="true" />
          ) : (
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={goBack}
              aria-disabled={pendingAttr}
              data-testid="back-action"
            >
              {t("action.back")}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className={buttonClass("primary")}
            onClick={attemptAdvance}
            aria-disabled={pendingAttr}
            data-testid="primary-action"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </PortalShell>
  );
}
