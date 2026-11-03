"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { FormPublishingWorkflow } from "@/lib/forms/types";

import { ReleaseVersionReview } from "@/components/forms/release-version-review";
import type { FormVersionSnapshot } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";
import type { PreviewTheme } from "@/lib/preview-theme";
import { Alert, Button, Dialog, Select } from "@/components/kit";
import { EnvironmentSummary, ReleaseHistory } from "@/components/forms/release-tables";
import type { ReleaseState } from "@/lib/forms/builder-state";
import { IDLE_RELEASE } from "@/lib/forms/builder-state";
import { PROD_ENVIRONMENT } from "@/lib/environment";
import { currentReleaseByEnvironment, type ReleaseRecord } from "@/lib/forms/releases";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { unexpected } from "@/lib/ops/unexpected";

const NO_SOURCE = "none";

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
  readonly releases: readonly ReleaseRecord[];
  readonly versions: readonly number[];
  readonly environments: readonly string[];
  readonly selectedEnvironment: string;
  readonly release: (input: { version: number; fromEnvironment?: string }) => Promise<ReleaseState>;
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

  // Snapshot the confirmation target so a refreshed tab cannot retarget an already-open dialog.
  const [shownEnvironment, setShownEnvironment] = useState(selectedEnvironment);
  if (shownEnvironment !== selectedEnvironment) {
    setShownEnvironment(selectedEnvironment);
    setOpen(false);
    setState(IDLE_RELEASE);
  }

  const current = currentReleaseByEnvironment(releases);
  const currentVersion = current.get(environment)?.version ?? workflow?.currentVersion ?? undefined;
  const isRollback =
    version !== undefined && currentVersion !== undefined && version < currentVersion;

  const gatedByRule = twoPerson.required && environment === PROD_ENVIRONMENT;
  const author = version === undefined ? null : (twoPerson.authorOf[String(version)] ?? null);
  // The second-person rule compares account identities, not role names.
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
        <EnvironmentSummary releases={releases} environments={environments} />
        <HeadingMarker control="releases.release">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
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
        </HeadingMarker>
        {versions.length === 0 && (
          <p className="text-sm text-(--color-text-muted)">{t("forms.releases.notPublished")}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("forms.releases.historyHeading")}</h2>
        <ReleaseHistory releases={releases} />
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
            <p className="text-sm font-semibold" data-testid="qcms-release-environment">
              {t("environment.inThis", { environment })}
            </p>
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
