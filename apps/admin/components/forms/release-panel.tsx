"use client";

import { useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Dialog, Select } from "@/components/kit";
import { OperatorDay } from "@/components/operator-time";
import type { ReleaseState } from "@/lib/forms/builder-state";
import { IDLE_RELEASE } from "@/lib/forms/builder-state";
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

export function ReleasePanel({
  releases,
  versions,
  environments,
  selectedEnvironment,
  release,
}: {
  /** The whole history, newest first, every environment. */
  readonly releases: readonly ReleaseRecord[];
  /** Every published version of this form, newest first. */
  readonly versions: readonly number[];
  /** The live environment set, in canonical order. */
  readonly environments: readonly string[];
  /** The operator's switcher selection, which is what the dialog opens on. */
  readonly selectedEnvironment: string;
  readonly release: (input: {
    environment: string;
    version: number;
    fromEnvironment?: string;
  }) => Promise<ReleaseState>;
}) {
  const [isOpen, setOpen] = useState(false);
  const [environment, setEnvironment] = useState(selectedEnvironment);
  const [version, setVersion] = useState(versions[0]);
  const [source, setSource] = useState<string>(NO_SOURCE);
  const [state, setState] = useState<ReleaseState>(IDLE_RELEASE);
  const [isPending, startTransition] = useTransition();

  const current = currentReleaseByEnvironment(releases);
  const currentVersion = current.get(environment)?.version;
  // The warning the dialog shows before anything is pressed. Derived the same way the API
  // derives the marking afterwards, from the version it is replacing - so the operator is
  // told it is a rollback by the screen that is about to do it, not only by the row that
  // records it.
  const isRollback =
    version !== undefined && currentVersion !== undefined && version < currentVersion;

  const run = (): void => {
    if (version === undefined) return;
    startTransition(() => {
      void release({
        environment,
        version,
        ...(source === NO_SOURCE ? {} : { fromEnvironment: source }),
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
            isDisabled={versions.length === 0 || isPending}
            onPress={() => {
              setState(IDLE_RELEASE);
              setEnvironment(selectedEnvironment);
              setVersion(versions[0]);
              setSource(NO_SOURCE);
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
              label={t("forms.releases.environment")}
              value={environment}
              onChange={(next) => {
                setEnvironment(next);
              }}
              items={environments.map((name) => ({ label: name, value: name }))}
            />
            <Select
              label={t("forms.releases.version")}
              value={String(version)}
              onChange={(next) => {
                setVersion(Number(next));
              }}
              items={versions.map((candidate) => ({
                label: t("forms.version.value", { version: candidate }),
                value: String(candidate),
              }))}
            />
            {/* The source environment records the path and authorises nothing (Q4): there
                is no ordering requirement, so "nowhere" is a first-class choice and a
                hotfix straight to `prod` is the ordinary shape of one. */}
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
            <p className="text-sm text-(--color-text-muted)">
              {t("forms.releases.dialogBody", { environment })}
            </p>
            {/* Q6's restatement, and the one sentence on this screen that exists because an
                act against the wrong environment is not undoable. */}
            <p className="text-sm font-semibold" data-testid="qcms-release-environment">
              {t("environment.inThis", { environment })}
            </p>
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
              <Button variant="primary" size="md" isDisabled={isPending} onPress={run}>
                {isPending
                  ? t("forms.releases.pending")
                  : t("forms.releases.confirm", { environment })}
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
