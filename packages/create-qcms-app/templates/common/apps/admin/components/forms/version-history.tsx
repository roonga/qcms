"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button, Select } from "@/components/kit";
import { OperatorDay } from "@/components/operator-time";
import { diffDefinitions, type DiffRow } from "@/lib/forms/version-diff";
import type { FormVersionSummary } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/* History renders stored compiled documents; recompilation would produce different audit evidence. */
type Filter = "all" | "released";

export function VersionHistory({
  formId,
  versions,
  definitionsByVersion,
  releasedBy = {},
  availableIn = {},
}: {
  readonly formId: string;
  readonly versions: readonly FormVersionSummary[];
  readonly definitionsByVersion: Readonly<Record<string, unknown>>;
  readonly releasedBy?: Readonly<Record<string, readonly string[]>>;
  readonly availableIn?: Readonly<Record<string, readonly string[]>>;
}) {
  const [older, setOlder] = useState<string>("");
  const [newer, setNewer] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");

  const items = versions.map((version) => ({
    value: String(version.version),
    label: t("forms.version.value", { version: version.version }),
  }));

  const shown =
    filter === "released"
      ? versions.filter((version) => (releasedBy[String(version.version)] ?? []).length > 0)
      : versions;
  const hidden = versions.length - shown.length;

  const diff = useMemo(() => {
    if (older === "" || newer === "" || older === newer) return undefined;
    return diffDefinitions(definitionsByVersion[older], definitionsByVersion[newer]);
  }, [older, newer, definitionsByVersion]);

  if (versions.length === 0) {
    return (
      <EmptyState
        heading={t("forms.history.emptyTitle")}
        body={t("forms.history.empty")}
        testId="qcms-history-empty"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-wrap items-center gap-3" data-testid="qcms-history-filter">
        <legend className="text-sm text-(--color-text-muted)">
          {t("forms.history.filter.legend")}
        </legend>
        {(["all", "released"] as const).map((value) => (
          <label key={value} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name="qcms-history-filter"
              value={value}
              checked={filter === value}
              onChange={() => {
                setFilter(value);
              }}
            />
            {t(`forms.history.filter.${value}`)}
          </label>
        ))}
        {filter === "released" && hidden > 0 && (
          <span className="text-sm text-(--color-text-muted)" data-testid="qcms-history-hidden">
            {t("forms.history.filter.hidden", { count: hidden })}
          </span>
        )}
      </fieldset>
      <div className="qcms-table qcms-table--versions">
        <table data-testid="qcms-history-table">
          <caption className="qcms-visually-hidden">{t("forms.history.table")}</caption>
          <thead>
            <tr>
              <th scope="col" className="qcms-cell--num">
                {t("forms.history.column.version")}
              </th>
              <th scope="col" className="qcms-cell--num">
                {t("forms.history.column.publishedAt")}
              </th>
              <th scope="col" className="qcms-cell--drop">
                {t("forms.history.column.compilerVersion")}
              </th>
              <th scope="col" className="qcms-cell--drop">
                {t("forms.history.column.a2uiSpecVersion")}
              </th>
              <th scope="col" className="qcms-cell--drop">
                {t("forms.history.column.semanticsVersion")}
              </th>
              <th scope="col">{t("forms.history.column.released")}</th>
              <th scope="col">{t("forms.versions.availableIn")}</th>
              <th scope="col" className="qcms-cell--drop">
                {t("forms.versions.publishedBy")}
              </th>
              <th scope="col">{t("forms.versions.review")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((version) => (
              <tr key={version.version} data-form-version={version.version}>
                <th scope="row" className="qcms-cell--num">
                  <Link
                    className="qcms-text-link"
                    href={`/forms/${encodeURIComponent(formId)}/versions/${String(version.version)}`}
                    aria-label={t("forms.history.view", { version: version.version })}
                  >
                    {t("forms.version.value", { version: version.version })}
                  </Link>
                </th>
                <td className="qcms-cell--num">
                  <OperatorDay iso={version.publishedAt} />
                </td>
                <td className="qcms-cell--drop">{version.compilerVersion}</td>
                <td className="qcms-cell--drop">{version.a2uiSpecVersion}</td>
                <td className="qcms-cell--drop">{version.semanticsVersion}</td>
                <td data-released={(releasedBy[String(version.version)] ?? []).join(" ")}>
                  {(releasedBy[String(version.version)] ?? []).length === 0
                    ? t("forms.history.releasedNowhere")
                    : t("forms.history.releasedIn", {
                        environments: (releasedBy[String(version.version)] ?? []).join(", "),
                      })}
                </td>
                <td data-available-in={(availableIn[String(version.version)] ?? []).join(" ")}>
                  {(availableIn[String(version.version)] ?? []).length === 0
                    ? t("forms.versions.availableNowhere")
                    : (availableIn[String(version.version)] ?? []).join(", ")}
                </td>
                <td className="qcms-cell--drop">
                  {version.publishedBy ?? t("forms.versions.publisherUnknown")}
                </td>
                <td>
                  <Link
                    className="qcms-text-link"
                    href={`/forms/${encodeURIComponent(formId)}/versions/${String(version.version)}`}
                    aria-label={t("forms.versions.reviewVersion", { version: version.version })}
                  >
                    {t("forms.versions.review")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="qcms-diff-heading" className="flex flex-col gap-3">
        <h2 id="qcms-diff-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.history.compare")}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t("forms.history.olderLabel")}
            items={items}
            value={older}
            onChange={setOlder}
          />
          <Select
            label={t("forms.history.newerLabel")}
            items={items}
            value={newer}
            onChange={setNewer}
          />
          <Button
            variant="ghost"
            size="md"
            onPress={() => {
              setOlder("");
              setNewer("");
            }}
          >
            {t("forms.history.clearCompare")}
          </Button>
        </div>

        {diff === undefined ? (
          <p className="text-sm text-(--color-text-muted)">{t("forms.history.compareNone")}</p>
        ) : (
          <DiffView older={older} newer={newer} rows={diff.rows} summary={diffSummary(diff)} />
        )}
      </section>
    </div>
  );
}

function diffSummary(diff: ReturnType<typeof diffDefinitions>): string {
  if (diff.tooLarge) return t("forms.history.compareTooLarge");
  if (diff.identical) return t("forms.history.compareIdentical");
  return t("forms.history.compareCounts", { added: diff.added, removed: diff.removed });
}

function DiffView({
  older,
  newer,
  rows,
  summary,
}: {
  readonly older: string;
  readonly newer: string;
  readonly rows: readonly DiffRow[];
  readonly summary: string;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="qcms-version-diff">
      <p className="text-sm text-(--color-text)">
        {t("forms.history.compareHeading", { older, newer })}
      </p>
      <p className="text-sm text-(--color-text-muted)" data-testid="qcms-diff-summary">
        {summary}
      </p>
      {rows.length > 0 && (
        <div className="qcms-diff" role="group" aria-label={summary} tabIndex={0}>
          <ol className="qcms-diff-rows">
            {rows.map((row, index) => (
              <li key={index} className={`qcms-diff-row qcms-diff-row--${row.kind}`}>
                <span className="qcms-visually-hidden">
                  {t(`forms.history.compareRow${kindKey(row)}`)}
                </span>
                <span aria-hidden="true" className="qcms-diff-marker">
                  {row.marker}
                </span>
                <span className="qcms-diff-side">{row.left ?? ""}</span>
                <span className="qcms-diff-side">{row.right ?? ""}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function kindKey(row: DiffRow): "Added" | "Removed" | "Same" {
  if (row.kind === "added") return "Added";
  if (row.kind === "removed") return "Removed";
  return "Same";
}
