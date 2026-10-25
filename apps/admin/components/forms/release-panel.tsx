"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { FormPublishingWorkflow } from "@/lib/forms/types";

import { ReleaseVersionReview } from "@/components/forms/release-version-review";
import type { FormVersionSnapshot } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";
import type { PreviewTheme } from "@/lib/preview-theme";
import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Dialog, Select } from "@/components/kit";
import { OperatorDay } from "@/components/operator-time";
import type { ReleaseState } from "@/lib/forms/builder-state";
import { IDLE_RELEASE } from "@/lib/forms/builder-state";
import { PROD_ENVIRONMENT } from "@/lib/environment";
import { currentReleaseByEnvironment, type ReleaseRecord } from "@/lib/forms/releases";
import { t } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/**
 * The release screen's body: what is released where, the history, and the release action
 * (ADR-40, task 065).
 *
 * ## Three readings of one list
 *
 * Everything here comes from one history, because the history is the model: the newest row
 * for a (form, environment) pair **is** what is released there (ADR-40), so "released now"
 * is a derivation of the table below it rather than a second read that could disagree with
 * it. The third reading is the rollback marking, which arrives on the row - the API derives
 * it from the release's own predecessor in that environment, so this screen renders a fact
 * and never compares version numbers itself.
 *
 * ## The rollback marking is a requirement, not decoration
 *
 * "Released version 4 after version 7" is the shape an incident review reads, and a history
 * that presented it as an ordinary row would make an operator count backwards to see what
 * happened (ADR-40, criterion 4). So a rollback row carries a badge and the version it
 * rolled back from, in words, in the row - not a colour, and not a tooltip.
 *
 * ## The confirmation names the environment (Q6)
 *
 * Every destructive or distributing action restates which environment it is about, because
 * an act performed against the wrong one is not undoable. Releasing is distributing: it
 * decides what a respondent is served. The dialog therefore names the environment in its
 * title, in its body and on its confirm button, and when the release moves the environment
 * **backwards** it says so before the operator presses anything.
 */
/**
 * The "there was no source environment" choice, as a value rather than an empty string.
 *
 * The kit's `Select` reads `""` as "nothing selected" and shows its placeholder, so an
 * empty value would make the ordinary case - a release with no source (Q4) - look like a
 * field the operator had forgotten to fill in.
 */
const NO_SOURCE = "none";

/**
 * What this release did to its environment, in one phrase.
 *
 * Three cases and they are not interchangeable: a rollback names the version it went back
 * from, a first release says so (there was nothing to replace), and an ordinary release
 * names what it replaced. An operator reading a history is asking which of the three each
 * row is, and a single "released v4" sentence makes them work it out from the row above.
 */
function movement(row: ReleaseRecord): string {
  if (row.rollback) {
    return t("forms.releases.rollbackFrom", { replaced: row.replacedVersion ?? 0 });
  }
  if (row.replacedVersion === null) return t("forms.releases.first");
  return t("forms.releases.replaced", { replaced: row.replacedVersion });
}

/**
 * The one sentence the two-person rule has to say about the selected pair (Q51, task 070).
 *
 * Three cases and they are not interchangeable - the operator published this version and
 * cannot release it, the author is unknown so the rule cannot be checked, or somebody else
 * published it and this operator is the second account - so it is a function rather than a
 * nested ternary inside the markup, which is both harder to read and a lint error here.
 */
function twoPersonSentence(input: {
  readonly blockedByRule: boolean;
  readonly author: string | null;
  readonly version: number;
  readonly environment: string;
}): string {
  if (input.blockedByRule) {
    return t("forms.releases.twoPersonSelf", {
      version: input.version,
      environment: input.environment,
    });
  }
  if (input.author === null) {
    return t("forms.releases.twoPersonUnknown", { version: input.version });
  }
  return t("forms.releases.twoPersonSecond", { environment: input.environment });
}

function releaseSource(
  releases: readonly ReleaseRecord[],
  version: number | undefined,
  environment: string,
  enabled: boolean,
  source: string,
): string | undefined {
  if (!enabled) return source === NO_SOURCE ? undefined : source;
  const reachedTest = releases.some((row) => row.environment === "test" && row.version === version);
  return environment === "prod" && reachedTest ? "test" : undefined;
}

function replacementMessage(
  current: number | undefined,
  version: number,
  environment: string,
): string {
  if (current === version) return t("forms.workflow.alreadyReleased", { version, environment });
  if (current === undefined) return t("forms.workflow.firstRelease", { version, environment });
  return t("forms.workflow.replacesVersion", { version, current, environment });
}

function releaseConfirm(
  pending: boolean,
  enabled: boolean,
  version: number,
  environment: string,
): string {
  if (pending) return t("forms.releases.pending");
  if (enabled) return t("forms.workflow.release", { version, environment });
  return t("forms.releases.confirm", { environment });
}

export function ReleasePanel({
  releases,
  versions,
  environments,
  selectedEnvironment,
  release,
  twoPerson,
  workflow,
  formId,
  reviewVersion,
  defaultTheme = "slate",
}: {
  readonly reviewVersion?:
    ((version: number) => Promise<ReadState<FormVersionSnapshot>>) | undefined;
  readonly defaultTheme?: PreviewTheme;
  readonly formId?: string;
  readonly workflow?: FormPublishingWorkflow | undefined;
  /** The whole history, newest first, every environment. */
  readonly releases: readonly ReleaseRecord[];
  /** Every published version of this form, newest first. */
  readonly versions: readonly number[];
  /** The live environment set, in canonical order. */
  readonly environments: readonly string[];
  /** The operator's switcher selection, which is what the dialog opens on. */
  readonly selectedEnvironment: string;
  readonly release: (input: { version: number; fromEnvironment?: string }) => Promise<ReleaseState>;
  /**
   * The two-person rule for production, where the workspace has turned it on (Q13, Q30,
   * Q51; task 070).
   *
   * `required` is the workspace's switch, `authorOf` is the account that **published** each
   * version (Q51's author) and `viewer` is the account reading the screen. The dialog uses
   * all three to say, before anything is pressed, whether this operator can release this
   * version into production - rather than letting them find out from a 403. Nothing here
   * decides anything (R2): the API refuses the act, and this is what stops the refusal
   * being the first the operator hears of the rule.
   */
  readonly twoPerson: {
    readonly required: boolean;
    readonly viewer: string;
    readonly authorOf: Readonly<Record<string, string | null>>;
  };
}) {
  const [isOpen, setOpen] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState<number>();
  const environment = selectedEnvironment;
  const candidates =
    workflow === undefined
      ? versions
      : versions.filter((v) => workflow.eligibleVersions.includes(v));
  const initialVersion = workflow?.preferredVersion ?? candidates[0];
  const [version, setVersion] = useState(initialVersion);
  const [source, setSource] = useState<string>(NO_SOURCE);
  const sourceEnvironment = releaseSource(
    releases,
    version,
    environment,
    workflow?.enabled === true,
    source,
  );
  const [state, setState] = useState<ReleaseState>(IDLE_RELEASE);
  const [isPending, startTransition] = useTransition();

  // A refreshed tab must never retarget a confirmation that was already open.
  const [shownEnvironment, setShownEnvironment] = useState(selectedEnvironment);
  if (shownEnvironment !== selectedEnvironment) {
    setShownEnvironment(selectedEnvironment);
    setOpen(false);
    setState(IDLE_RELEASE);
  }

  const current = currentReleaseByEnvironment(releases);
  const currentVersion = current.get(environment)?.version ?? workflow?.currentVersion ?? undefined;
  // The warning the dialog shows before anything is pressed. Derived the same way the API
  // derives the marking afterwards, from the version it is replacing - so the operator is
  // told it is a rollback by the screen that is about to do it, not only by the row that
  // records it.
  const isRollback =
    version !== undefined && currentVersion !== undefined && version < currentVersion;

  // The two-person rule's three readings of the selected (version, environment) pair. The
  // rule gates `prod` alone (finding 5), so this is false everywhere else whatever the
  // workspace setting says - which is the same narrowing the API makes.
  const gatedByRule = twoPerson.required && environment === PROD_ENVIRONMENT;
  const author = version === undefined ? null : (twoPerson.authorOf[String(version)] ?? null);
  // Two accounts, not two kinds of person: what blocks the release is this operator having
  // published this version, never which roles they hold.
  const blockedByRule = gatedByRule && author !== null && author === twoPerson.viewer;

  const run = (): void => {
    if (version === undefined) return;
    startTransition(() => {
      void release({
        version,
        ...(sourceEnvironment === undefined ? {} : { fromEnvironment: sourceEnvironment }),
      })
        .then((next) => {
          setState(next);
          if (next.status === "released") setOpen(false);
        })
        // `adminApiFetch` does not throw on a non-2xx, which is the trap: a transport
        // failure still rejects, and without this the dialog would sit there looking like a
        // slow network forever.
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  };

  return (
    <section className="flex flex-col gap-6" data-testid="qcms-release-panel">
      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-release-status">
        {state.status === "released" && (
          <Alert variant="success">
            {state.rollback === true
              ? t("forms.releases.rollbackDone", {
                  version: state.version ?? 0,
                  environment: state.environment ?? "",
                })
              : t("forms.releases.released", {
                  version: state.version ?? 0,
                  environment: state.environment ?? "",
                })}
          </Alert>
        )}
        {state.status === "error" && (
          <Alert variant="error">
            {t("forms.releases.failed", { message: state.message ?? "" })}
          </Alert>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("forms.releases.currentHeading")}</h2>
        <div className="qcms-table">
          <table data-testid="qcms-released-now">
            <caption className="qcms-visually-hidden">{t("forms.releases.currentTable")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("forms.releases.column.environment")}</th>
                <th scope="col" className="qcms-cell--num">
                  {t("forms.releases.column.version")}
                </th>
                <th scope="col">{t("forms.releases.column.releasedAt")}</th>
                <th scope="col" className="qcms-cell--drop">
                  {t("forms.releases.column.releasedBy")}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Every environment, including the ones with nothing released: "not released
                  in prod" is the answer an operator most needs and a row that was simply
                  absent would make them wonder whether the screen had loaded. */}
              {environments.map((name) => {
                const released = current.get(name);
                return (
                  <tr key={name} data-environment={name}>
                    <th scope="row">{name}</th>
                    <td className="qcms-cell--num">
                      {released === undefined
                        ? t("forms.releases.none")
                        : t("forms.version.value", { version: released.version })}
                    </td>
                    <td>
                      {released === undefined ? "" : <OperatorDay iso={released.releasedAt} />}
                    </td>
                    <td className="qcms-cell--drop">{released?.releasedBy ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="md"
            // No environments is the set the shell could not read (A12): nothing to aim at.
            isDisabled={
              candidates.length === 0 ||
              environments.length === 0 ||
              selectedEnvironment === "" ||
              isPending ||
              workflow?.canRelease === false
            }
            onPress={() => {
              setState(IDLE_RELEASE);
              setVersion(initialVersion);
              setSource(NO_SOURCE);
              setReviewedVersion(undefined);
              setOpen(true);
            }}
          >
            {t("forms.releases.action")}
          </Button>
        </div>
        {versions.length === 0 && (
          <p className="text-sm text-(--color-text-muted)">{t("forms.releases.notPublished")}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("forms.releases.historyHeading")}</h2>
        {releases.length === 0 ? (
          <EmptyState
            testId="qcms-releases-empty"
            heading={t("forms.releases.emptyTitle")}
            body={t("forms.releases.empty")}
          />
        ) : (
          <div className="qcms-table">
            <table data-testid="qcms-release-history">
              <caption className="qcms-visually-hidden">{t("forms.releases.historyTable")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("forms.releases.column.environment")}</th>
                  <th scope="col" className="qcms-cell--num">
                    {t("forms.releases.column.version")}
                  </th>
                  <th scope="col">{t("forms.releases.column.releasedAt")}</th>
                  <th scope="col" className="qcms-cell--drop">
                    {t("forms.releases.column.releasedBy")}
                  </th>
                  <th scope="col" className="qcms-cell--drop">
                    {t("forms.releases.column.fromEnvironment")}
                  </th>
                  <th scope="col" className="qcms-cell--drop">
                    {t("forms.releases.column.approvedBy")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {releases.map((row) => (
                  <tr
                    key={`${row.environment}-${row.sequence}`}
                    data-environment={row.environment}
                    data-version={row.version}
                    data-rollback={row.rollback ? "true" : "false"}
                  >
                    <th scope="row">{row.environment}</th>
                    <td className="qcms-cell--num">
                      {t("forms.version.value", { version: row.version })}
                      {row.rollback && (
                        <>
                          {" "}
                          <span className="qcms-rollback" data-testid="qcms-rollback-mark">
                            {t("forms.releases.rollback")}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <OperatorDay iso={row.releasedAt} />
                      <span className="block text-xs text-(--color-text-muted)">
                        {movement(row)}
                      </span>
                    </td>
                    <td className="qcms-cell--drop">{row.releasedBy}</td>
                    <td className="qcms-cell--drop">
                      {row.fromEnvironment ?? t("forms.releases.noSource")}
                    </td>
                    <td className="qcms-cell--drop">
                      {row.approvedBy ?? t("forms.releases.noApproval")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {workflow?.canRelease === false && (
        <p>{t("forms.workflow.noReleasePermission", { environment })}</p>
      )}
      {candidates.length === 0 && <p>{t("forms.workflow.noCandidate", { environment })}</p>}

      {isOpen && version !== undefined && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.releases.dialogTitle", { version, environment })}
          isDismissable={!isPending}
          onOpenChange={(open) => {
            if (!open) setOpen(false);
          }}
        >
          <div className="flex flex-col gap-4" data-testid="qcms-release-dialog">
            <Select
              label={t("forms.releases.version")}
              value={String(version)}
              onChange={(next) => {
                setVersion(Number(next));
              }}
              items={candidates.map((candidate) => ({
                label: t("forms.version.value", { version: candidate }),
                value: String(candidate),
              }))}
            />
            {workflow?.enabled !== true && (
              <Select
                label={t("forms.releases.fromEnvironment")}
                value={source}
                onChange={(next) => {
                  setSource(next);
                }}
                items={[
                  { label: t("forms.releases.fromNone"), value: NO_SOURCE },
                  ...environments
                    .filter((name) => name !== environment)
                    .map((name) => ({ label: name, value: name })),
                ]}
              />
            )}
            {workflow?.enabled && sourceEnvironment === "test" && (
              <p>{t("forms.workflow.testCandidate")}</p>
            )}
            {(formId ?? releases[0]?.formId) !== undefined && (
              <Link
                className="qcms-text-link"
                href={`/forms/${encodeURIComponent(formId ?? releases[0]?.formId ?? "")}/versions/${String(version)}`}
              >
                {t("forms.workflow.reviewVersion", { version })}
              </Link>
            )}
            <p className="text-sm text-(--color-text-muted)">
              {t("forms.releases.dialogBody", { environment })}
            </p>
            <p data-testid="qcms-release-replacement">
              {replacementMessage(currentVersion, version, environment)}
            </p>
            {reviewVersion !== undefined && (
              <ReleaseVersionReview
                version={version}
                read={reviewVersion}
                defaultTheme={defaultTheme}
                onReady={setReviewedVersion}
              />
            )}
            {/* Q6's restatement, and the one sentence on this screen that exists because an
                act against the wrong environment is not undoable. */}
            <p className="text-sm font-semibold" data-testid="qcms-release-environment">
              {t("environment.inThis", { environment })}
            </p>
            {/* The two-person rule, stated before the press (Q51, task 070). Three cases
                and they are not interchangeable: the operator published this version and
                cannot release it, the author is unknown so the rule cannot be checked, or
                somebody else published it and this operator is the second account. */}
            {gatedByRule && (
              <div data-testid="qcms-release-two-person">
                <Alert variant={blockedByRule ? "error" : "info"}>
                  {twoPersonSentence({ blockedByRule, author, version, environment })}
                </Alert>
              </div>
            )}
            {isRollback && (
              <div data-testid="qcms-release-rollback-warning">
                <Alert variant="warning">
                  {t("forms.releases.rollbackWarning", {
                    environment,
                    current: currentVersion ?? 0,
                    version,
                  })}
                </Alert>
              </div>
            )}
            {state.status === "error" && (
              <Alert variant="error">
                {t("forms.releases.failed", { message: state.message ?? "" })}
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="md"
                // Disabled rather than left to fail: the API refuses this exact pair with
                // a 403, and a button that is certain to be refused is a button that
                // teaches the rule by refusing. Every other refusal the rule can raise
                // depends on the caller's grants, which this screen does not hold, so
                // those are still the API's to answer.
                isDisabled={
                  isPending ||
                  (reviewVersion !== undefined && reviewedVersion !== version) ||
                  (workflow?.enabled === true && currentVersion === version) ||
                  blockedByRule ||
                  (gatedByRule && author === null) ||
                  workflow?.canRelease === false
                }
                onPress={run}
              >
                {releaseConfirm(isPending, workflow?.enabled === true, version, environment)}
              </Button>
              <Button
                variant="ghost"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setOpen(false);
                }}
              >
                {t("forms.releases.cancel")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
