"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Alert,
  Button,
  Checkbox,
  RadioButton,
  RadioField,
  RadioGroup,
  Select,
} from "@/components/kit";
import { AgentProvenanceTag } from "@/components/forms/agent-provenance-tag";
import { HelpTip } from "@/components/help-tip";
import { environmentCookie } from "@/lib/environment";
import type { PublishBatchState } from "@/lib/forms/builder-state";
import { IDLE_PUBLISH_BATCH } from "@/lib/forms/builder-state";
import { freezeSummary } from "@/lib/forms/publish";
import type { DraftForm } from "@/lib/forms/types";
import type {
  PublishDestination,
  PublishIntent,
  ReleaseBlockerRecord,
  ReleaseReview,
  ReviewTarget,
} from "@/lib/forms/release-candidate";
import { isTargetEligible } from "@/lib/forms/release-candidate";
import type { ReadState } from "@/lib/read-state";
import { t, tPlural } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/* Confirm all destinations in one transaction; a client loop could leave partial releases. Reuse the key
   only for the same intent. */

type Step = "source" | "destinations" | "review";

function stepName(step: Step): string {
  if (step === "source") return t("forms.publish.step.source");
  if (step === "destinations") return t("forms.publish.step.destinations");
  return t("forms.publish.step.review");
}

function blockerSentence(blocker: ReleaseBlockerRecord, environment: string): string {
  switch (blocker.code) {
    case "TEST_RELEASE_REQUIRED":
    case "PRIOR_RELEASE_REQUIRED":
      return t("forms.publish.blocked.priorRelease", {
        environments: blocker.requiresAnyOf.join(", "),
      });
    case "DRAFT_PUBLISH_NOT_ALLOWED":
      return t("forms.publish.blocked.draftNotAllowed", { environment });
    case "ALREADY_RELEASED":
      return t("forms.publish.blocked.alreadyReleased");
    case "APPROVER_IS_AUTHOR":
      return t("forms.publish.blocked.approverIsAuthor", { environment });
    case "APPROVER_UNKNOWN_AUTHOR":
      return t("forms.publish.blocked.approverUnknownAuthor");
    default:
      return t("forms.publish.blocked.other", { code: blocker.code });
  }
}

function transition(target: ReviewTarget, review: ReleaseReview): string {
  const isDraft = review.source.kind === "draft";
  if (target.currentVersion === null) {
    return t(
      isDraft
        ? "forms.publish.review.transitionDraftFirst"
        : "forms.publish.review.transitionFirst",
      {
        environment: target.environment,
        version: review.source.kind === "version" ? review.source.version : 0,
      },
    );
  }
  if (isDraft) {
    return t("forms.publish.review.transitionDraft", {
      environment: target.environment,
      current: target.currentVersion,
    });
  }
  return t("forms.publish.review.transition", {
    environment: target.environment,
    current: target.currentVersion,
    version: review.source.kind === "version" ? review.source.version : 0,
  });
}

function sourceOf(
  kind: "draft" | "version",
  version: number | undefined,
): { kind: "draft" } | { kind: "version"; version: number } | undefined {
  if (kind === "draft") return { kind: "draft" };
  if (version === undefined) return undefined;
  return { kind: "version", version };
}

function PublishResult({
  formId,
  state,
  secureCookies,
}: {
  readonly formId: string;
  readonly state: PublishBatchState;
  readonly secureCookies: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const releases = state.releases ?? [];

  const openOperations = (environment: string): void => {
    document.cookie = environmentCookie(environment, secureCookies);
    startTransition(() => {
      router.push("/operations");
    });
  };
  return (
    <section className="flex flex-col gap-4" data-testid="qcms-publish-result">
      <div
        aria-live="polite"
        className="flex flex-col gap-2"
        data-testid="qcms-publish-result-status"
      >
        <Alert variant="success">
          {t(
            state.froze === true ? "forms.publish.result.version" : "forms.publish.result.released",
            {
              version: state.version ?? 0,
            },
          )}
        </Alert>
        {state.replayed === true && (
          <Alert variant="info">{t("forms.publish.result.replayed")}</Alert>
        )}
      </div>
      <h2 className="text-base font-semibold">{t("forms.publish.result.heading")}</h2>
      {releases.length === 0 ? (
        <p>{t("forms.publish.result.noRelease")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {releases.map((release) => (
            <li key={release.environment} data-environment={release.environment}>
              {t(
                release.rollback
                  ? "forms.publish.result.rolledBackIn"
                  : "forms.publish.result.releasedIn",
                { environment: release.environment },
              )}{" "}
              <Button
                variant="secondary"
                size="sm"
                isDisabled={isPending}
                onPress={() => {
                  openOperations(release.environment);
                }}
              >
                {t("forms.publish.result.operations", { environment: release.environment })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}/versions`}>
          {t("forms.publish.result.versions")}
        </Link>
      </div>
    </section>
  );
}

/* Review the stored draft because that is what confirmation freezes, independently of unsaved browser
   state. */
function FreezeSummary({
  draft,
  agentAssisted,
}: {
  readonly draft: DraftForm;
  readonly agentAssisted: boolean;
}) {
  const summary = freezeSummary(draft);
  return (
    <>
      {agentAssisted && (
        <div data-testid="qcms-publish-provenance">
          <AgentProvenanceTag />
        </div>
      )}
      <p className="text-sm text-(--color-text)" data-testid="qcms-freeze-summary">
        {t("forms.publish.freezes", {
          steps: tPlural(
            "forms.publish.freezes.steps.one",
            "forms.publish.freezes.steps.other",
            summary.steps,
          ),
          pins: tPlural(
            "forms.publish.freezes.pins.one",
            "forms.publish.freezes.pins.other",
            summary.pins,
          ),
          rules: tPlural(
            "forms.publish.freezes.rules.one",
            "forms.publish.freezes.rules.other",
            summary.rules,
          ),
        })}
      </p>
      <p className="text-sm text-(--color-text-muted)">{t("forms.publish.immutable")}</p>
    </>
  );
}

function PublishRejected({ formId, count }: { readonly formId: string; readonly count: number }) {
  return (
    <section
      aria-labelledby="qcms-publish-rejected-heading"
      data-testid="qcms-publish-rejected"
      className="flex flex-col gap-2 rounded-md border border-(--color-border-strong) bg-(--color-background-muted) p-4"
    >
      <h2
        id="qcms-publish-rejected-heading"
        className="text-base font-semibold text-(--color-text)"
      >
        {t("forms.publish.blocked")}
      </h2>
      <p className="text-sm text-(--color-text-muted)">
        {tPlural(
          "forms.publish.wizardBlockedCount.one",
          "forms.publish.wizardBlockedCount.other",
          count,
        )}
      </p>
      <div>
        <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}`}>
          {t("forms.publish.wizardBlockedLink")}
        </Link>
      </div>
    </section>
  );
}

/* After an uncertain response, look up the recorded result before offering a replay with the same key. */
function ConfirmControls({
  state,
  isPending,
  canConfirm,
  onConfirm,
  onLookup,
  onRefresh,
}: {
  readonly state: PublishBatchState;
  readonly isPending: boolean;
  readonly canConfirm: boolean;
  readonly onConfirm: () => void;
  readonly onLookup: () => void;
  readonly onRefresh: () => void;
}) {
  if (state.status === "uncertain") {
    return (
      <>
        <Button variant="primary" size="md" isDisabled={isPending} onPress={onLookup}>
          {t("forms.publish.lookup")}
        </Button>
        <Button variant="ghost" size="md" isDisabled={isPending} onPress={onConfirm}>
          {t("forms.publish.wizardConfirm")}
        </Button>
      </>
    );
  }
  if (state.status === "stale") {
    return (
      <Button variant="primary" size="md" isDisabled={isPending} onPress={onRefresh}>
        {t("forms.publish.refresh")}
      </Button>
    );
  }
  return (
    <Button variant="primary" size="md" isDisabled={!canConfirm || isPending} onPress={onConfirm}>
      {isPending ? t("forms.publish.wizardPending") : t("forms.publish.wizardConfirm")}
    </Button>
  );
}

export function PublishWizard({
  formId,
  versions,
  hasDraft,
  canPublishDraft,
  draft,
  agentAssisted = false,
  review: readReview,
  confirm,
  lookup,
  secureCookies,
}: {
  readonly formId: string;
  readonly versions: readonly number[];
  readonly hasDraft: boolean;
  readonly canPublishDraft: boolean;
  readonly draft: DraftForm | null;
  readonly agentAssisted?: boolean;
  readonly review: (
    source: { kind: "draft" } | { kind: "version"; version: number },
  ) => Promise<ReadState<ReleaseReview>>;
  readonly confirm: (request: {
    idempotencyKey: string;
    expectedWorkflowRevision: number | null;
    source: PublishIntent;
    targets: readonly PublishDestination[];
  }) => Promise<PublishBatchState>;
  readonly lookup: (idempotencyKey: string) => Promise<PublishBatchState>;
  readonly secureCookies: boolean;
}) {
  const [step, setStep] = useState<Step>("source");
  const [sourceKind, setSourceKind] = useState<"draft" | "version">(
    hasDraft && canPublishDraft ? "draft" : "version",
  );
  const [version, setVersion] = useState<number | undefined>(versions[0]);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [publishOnly, setPublishOnly] = useState(false);
  const [review, setReview] = useState<ReleaseReview>();
  const [reviewFailed, setReviewFailed] = useState(false);
  const [key, setKey] = useState<string>();
  const [state, setState] = useState<PublishBatchState>(IDLE_PUBLISH_BATCH);
  const [isPending, startTransition] = useTransition();
  const headingRef = useRef<HTMLElement | null>(null);
  const setHeading = useCallback((node: HTMLElement | null) => {
    headingRef.current = node;
  }, []);
  const [moves, setMoves] = useState(0);

  const goTo = useCallback((next: Step) => {
    setStep(next);
    setMoves((count) => count + 1);
  }, []);

  /* Focus the next step after unmounting the previous one so keyboard users do not restart at the document
     body. */
  useEffect(() => {
    if (moves > 0) headingRef.current?.focus();
  }, [moves]);

  const resetFromSource = useCallback(() => {
    setChosen([]);
    setPublishOnly(false);
    setReview(undefined);
    setReviewFailed(false);
    setKey(undefined);
    setState(IDLE_PUBLISH_BATCH);
  }, []);

  const source = sourceOf(sourceKind, version);

  const loadReview = useCallback(
    (next: Step) => {
      if (source === undefined) return;
      setReviewFailed(false);
      startTransition(() => {
        void readReview(source)
          .then((result) => {
            if (!result.ok) {
              setReviewFailed(true);
              return;
            }
            setReview(result.data);
            goTo(next);
          })
          .catch(() => {
            setReviewFailed(true);
          });
      });
    },
    [goTo, readReview, source],
  );

  const targets = review?.targets ?? [];
  const selectable = targets.filter((target) => isTargetEligible(target));
  const selected = targets.filter((target) => chosen.includes(target.environment));
  const destinations: readonly PublishDestination[] = publishOnly
    ? []
    : selected.map((target) => {
        const from = target.evidence.find((row) => row.environment !== target.environment);
        return {
          environment: target.environment,
          expectedSequence: target.currentSequence,
          ...(from === undefined ? {} : { fromEnvironment: from.environment }),
        };
      });
  const canConfirm = publishOnly || destinations.length > 0;

  const run = useCallback(() => {
    if (review === undefined || !canConfirm) return;
    const intent: PublishIntent =
      review.source.kind === "draft"
        ? { kind: "draft", draftRevision: review.source.draftRevision }
        : { kind: "version", version: review.source.version };
    const idempotencyKey = key ?? crypto.randomUUID();
    setKey(idempotencyKey);
    startTransition(() => {
      void confirm({
        idempotencyKey,
        expectedWorkflowRevision: review.workflowRevision,
        source: intent,
        targets: destinations,
      })
        .then(setState)
        .catch(() => {
          setState({ status: "uncertain", message: unexpected() });
        });
    });
  }, [canConfirm, confirm, destinations, key, review]);

  const runLookup = useCallback(() => {
    if (key === undefined) return;
    startTransition(() => {
      void lookup(key)
        .then(setState)
        .catch(() => {
          setState({ status: "uncertain", message: unexpected() });
        });
    });
  }, [key, lookup]);

  if (state.status === "done") {
    return <PublishResult formId={formId} state={state} secureCookies={secureCookies} />;
  }

  return (
    <section className="flex flex-col gap-6" data-testid="qcms-publish-wizard" data-step={step}>
      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-publish-status">
        {state.status === "stale" && (
          <div data-testid="qcms-publish-stale">
            <Alert variant="warning">{t("forms.publish.stale")}</Alert>
          </div>
        )}
        {state.status === "uncertain" && (
          <div data-testid="qcms-publish-uncertain">
            <Alert variant="warning">{t("forms.publish.uncertain")}</Alert>
          </div>
        )}
        {state.status === "rejected" && (
          <Alert variant="error">
            {t("forms.publish.wizardFailed", { message: state.message ?? "" })}
          </Alert>
        )}
        {state.status === "error" && (
          <Alert variant="error">
            {t("forms.publish.wizardFailed", { message: state.message ?? "" })}
          </Alert>
        )}
        {/* Only a lookup 404 proves the confirmation did not commit; idle state or an existing key cannot establish
   that. */}
        {state.status === "not-committed" && (
          <div data-testid="qcms-publish-nothing-committed">
            <Alert variant="info">{t("forms.publish.lookupNothing")}</Alert>
          </div>
        )}
        {reviewFailed && <Alert variant="error">{t("forms.publish.reviewFailed")}</Alert>}
        <span className="qcms-visually-hidden" data-testid="qcms-publish-step-status">
          {moves > 0 ? t("forms.publish.step.announce", { step: stepName(step) }) : ""}
        </span>
      </div>

      {state.status === "rejected" && (state.issues ?? []).length > 0 && (
        <PublishRejected formId={formId} count={(state.issues ?? []).length} />
      )}

      {step === "source" && (
        <fieldset className="flex flex-col gap-3" data-testid="qcms-publish-source">
          <legend className="text-base font-semibold" ref={setHeading} tabIndex={-1}>
            {t("forms.publish.step.source")}
          </legend>
          <RadioGroup
            className="flex flex-col gap-3"
            aria-label={t("forms.publish.step.source")}
            value={sourceKind}
            onChange={(next) => {
              setSourceKind(next === "draft" ? "draft" : "version");
              resetFromSource();
            }}
          >
            <RadioField value="draft" isDisabled={!hasDraft || !canPublishDraft}>
              <RadioButton className="qcms-radio">
                <span className="qcms-radio__dot" aria-hidden="true" />
                <span className="flex flex-col">
                  <span>{t("forms.publish.source.draft")}</span>
                  <span className="text-sm text-(--color-text-muted)">
                    {hasDraft
                      ? t("forms.publish.source.draftHint")
                      : t("forms.publish.source.noDraft")}
                  </span>
                </span>
              </RadioButton>
            </RadioField>
            <RadioField value="version" isDisabled={versions.length === 0}>
              <RadioButton className="qcms-radio">
                <span className="qcms-radio__dot" aria-hidden="true" />
                <span className="flex flex-col">
                  <span>{t("forms.publish.source.version")}</span>
                  {versions.length === 0 && (
                    <span className="text-sm text-(--color-text-muted)">
                      {t("forms.publish.source.noVersions")}
                    </span>
                  )}
                </span>
              </RadioButton>
            </RadioField>
          </RadioGroup>
          {sourceKind === "version" && versions.length > 0 && (
            <Select
              label={t("forms.publish.source.versionLabel")}
              value={String(version ?? versions[0])}
              onChange={(next) => {
                setVersion(Number(next));
                resetFromSource();
              }}
              items={versions.map((candidate) => ({
                label: t("forms.version.value", { version: candidate }),
                value: String(candidate),
              }))}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              isDisabled={source === undefined || isPending}
              onPress={() => {
                loadReview("destinations");
              }}
            >
              {isPending ? t("forms.publish.reviewing") : t("forms.publish.next")}
            </Button>
            <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}/versions`}>
              {t("forms.publish.wizardCancel")}
            </Link>
          </div>
        </fieldset>
      )}

      {step === "destinations" && review !== undefined && (
        <fieldset className="flex flex-col gap-3" data-testid="qcms-publish-destinations">
          <legend className="text-base font-semibold" ref={setHeading} tabIndex={-1}>
            {t("forms.publish.step.destinations")}{" "}
            <HelpTip>{t("forms.publish.destinations.hint")}</HelpTip>
          </legend>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-publish-workflow">
            {review.workflowSource === "configured"
              ? t("forms.publish.workflow.configured", { revision: review.workflowRevision ?? 0 })
              : t("forms.publish.workflow.default")}
          </p>
          {targets.length === 0 && <p>{t("forms.publish.destinations.none")}</p>}
          {targets.map((target) => {
            const eligible = isTargetEligible(target);
            return (
              <div
                key={target.environment}
                className="flex flex-col gap-1"
                data-environment={target.environment}
                data-eligible={eligible ? "true" : "false"}
              >
                <Checkbox
                  label={target.environment}
                  isSelected={chosen.includes(target.environment)}
                  isDisabled={!eligible || publishOnly}
                  onChange={(next) => {
                    setChosen((current) =>
                      next
                        ? [...current, target.environment]
                        : current.filter((name) => name !== target.environment),
                    );
                    setKey(undefined);
                    setState(IDLE_PUBLISH_BATCH);
                  }}
                />
                <span className="text-sm text-(--color-text-muted)">
                  {target.currentVersion === null
                    ? t("forms.publish.destinations.unreleased")
                    : t("forms.publish.destinations.serving", { version: target.currentVersion })}
                  {target.protected && ` · ${t("forms.publish.destinations.protected")}`}
                </span>
                {target.closed && (
                  <span className="text-sm text-(--color-text-muted)">
                    {t("forms.publish.destinations.closedNote")}
                  </span>
                )}
                {target.blockers.map((blocker) => (
                  <span
                    key={blocker.code}
                    className="text-sm"
                    data-testid="qcms-publish-blocker"
                    data-code={blocker.code}
                  >
                    {blockerSentence(blocker, target.environment)}
                  </span>
                ))}
              </div>
            );
          })}
          {review.source.kind === "draft" && (
            // A production release may require a different account from the publisher; freezing without releasing
            // enables that handoff.
            <div data-testid="qcms-publish-only">
              <Checkbox
                label={t("forms.publish.destinations.publishOnly")}
                isSelected={publishOnly}
                onChange={(next) => {
                  setPublishOnly(next);
                  if (next) setChosen([]);
                  setKey(undefined);
                  setState(IDLE_PUBLISH_BATCH);
                }}
              />
              <span className="block text-sm text-(--color-text-muted)">
                {t("forms.publish.destinations.publishOnlyHint")}
              </span>
            </div>
          )}
          {!canConfirm && selectable.length > 0 && (
            <p className="text-sm text-(--color-text-muted)">
              {t("forms.publish.destinations.pickOne")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              isDisabled={!canConfirm || isPending}
              onPress={() => {
                goTo("review");
              }}
            >
              {t("forms.publish.next")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                goTo("source");
              }}
            >
              {t("forms.publish.back")}
            </Button>
          </div>
        </fieldset>
      )}

      {step === "review" && review !== undefined && (
        <div className="flex flex-col gap-3" data-testid="qcms-publish-review">
          <h2 className="text-base font-semibold" ref={setHeading} tabIndex={-1}>
            {t("forms.publish.step.review")}
          </h2>
          <p>
            {review.source.kind === "draft"
              ? t("forms.publish.review.sourceDraft")
              : t("forms.publish.review.sourceVersion", { version: review.source.version })}
          </p>
          {review.source.kind === "version" && review.source.publishedBy !== null && (
            <p className="text-sm text-(--color-text-muted)">
              {t("forms.publish.source.publishedBy", { publisher: review.source.publishedBy })}
            </p>
          )}
          {review.source.kind === "draft" && draft !== null && (
            <FreezeSummary draft={draft} agentAssisted={agentAssisted} />
          )}
          {publishOnly ? (
            <p data-testid="qcms-publish-review-publish-only">
              {t("forms.publish.review.publishOnly")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selected.map((target) => (
                <li
                  key={target.environment}
                  className="flex flex-col gap-1"
                  data-environment={target.environment}
                >
                  <span>{transition(target, review)}</span>
                  {target.closed && (
                    <span className="text-sm text-(--color-text-muted)">
                      {t("forms.publish.destinations.closedNote")}
                    </span>
                  )}
                  {review.source.kind === "version" &&
                    target.currentVersion !== null &&
                    review.source.version < target.currentVersion && (
                      <span className="text-sm" data-testid="qcms-publish-rollback">
                        {t("forms.publish.destinations.rollbackNote", {
                          environment: target.environment,
                          current: target.currentVersion,
                        })}
                      </span>
                    )}
                  {target.evidence.map((row) => (
                    <span
                      key={`${row.environment}-${row.sequence}`}
                      className="text-sm text-(--color-text-muted)"
                    >
                      {t("forms.publish.destinations.evidence", {
                        version: row.version,
                        environment: row.environment,
                      })}
                    </span>
                  ))}
                  {target.twoPerson.applies && (
                    <span className="text-sm" data-testid="qcms-publish-second-person">
                      {t("forms.publish.review.secondPerson", { environment: target.environment })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <ConfirmControls
              state={state}
              isPending={isPending}
              canConfirm={canConfirm}
              onConfirm={run}
              onLookup={runLookup}
              onRefresh={() => {
                setKey(undefined);
                setState(IDLE_PUBLISH_BATCH);
                loadReview("review");
              }}
            />
            <Button
              variant="ghost"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                goTo("destinations");
                setState(IDLE_PUBLISH_BATCH);
              }}
            >
              {t("forms.publish.back")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
