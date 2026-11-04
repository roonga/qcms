"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { EmptyState } from "@/components/empty-state";
import { EntityId } from "@/components/entity-id";
import { Button, DatePicker, Dialog, Select } from "@/components/kit";
import { FlagTag } from "@/components/ops/ops-tags";
import { answerPreviewText } from "@/lib/ops/answers";
import type { AppliedFilters } from "@/lib/ops/browse";
import { draftDayZone, responsePageLink } from "@/lib/ops/browse";
import type { ExportChoice, ExportFormat, ExportShape } from "@/lib/ops/export";
import {
  DEFAULT_EXPORT_SHAPE,
  exportQuery,
  isExportable,
  shapeApplies,
  versionRequired,
} from "@/lib/ops/export";
import type { ResponsePage } from "@/lib/ops/types";
import { OperatorDateTime, useOperatorZone } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";
import { useHandOff } from "@/lib/agent/waiting";

/* A failed read cannot justify a count, empty state, table, or pager; retain only navigation and
   retry-capable filters. */
export function ResponseBrowser({
  formId,
  page,
  versions,
  filters,
  hasFilters,
}: {
  readonly formId: string;
  readonly page: ReadState<ResponsePage>;
  /** `undefined` is "not read": an unknown version list must not be shown as an empty one. */
  readonly versions: readonly number[] | undefined;
  readonly filters: AppliedFilters;
  readonly hasFilters: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const operatorZone = useOperatorZone();

  // Control edits are unapplied until Apply; filters describes only the query the server actually used.
  const [version, setVersion] = useState(filters.version);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [flagged, setFlagged] = useState(filters.flagged);
  const [exporting, setExporting] = useState(false);
  const [handedOff, setHandedOff] = useState<Readonly<Record<string, string>> | undefined>(
    undefined,
  );
  const handOff = useHandOff("responses.export");
  useEffect(() => {
    if (handOff === undefined) return;
    setHandedOff(handOff.fields);
    setExporting(true);
    handOff.done();
  }, [handOff]);
  const draftZone = draftDayZone(filters, { from, to }, operatorZone);
  const dayZone = draftZone ?? t("ops.common.yourZone");

  // Reseed local filter edits when the applied query changes so Back and Forward cannot leave controls
  // describing stale results.
  const applied = `${filters.version}|${filters.from}|${filters.to}|${filters.flagged}|${filters.tz ?? ""}`;
  const [seeded, setSeeded] = useState(applied);
  if (seeded !== applied) {
    setSeeded(applied);
    setVersion(filters.version);
    setFrom(filters.from);
    setTo(filters.to);
    setFlagged(filters.flagged);
  }

  const base = `/operations/forms/${encodeURIComponent(formId)}/responses`;

  const go = useCallback(
    (next: Readonly<Record<string, string>>) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value !== "") search.set(key, value);
      }
      const query = search.toString();
      startTransition(() => {
        router.push(query === "" ? base : `${base}?${query}`);
      });
    },
    [router, base],
  );

  const apply = useCallback(() => {
    go({
      version,
      from,
      to,
      flagged,
      tz: from !== "" || to !== "" ? (draftZone ?? "") : "",
    });
  }, [go, version, from, to, flagged, draftZone]);

  const clear = useCallback(() => {
    setVersion("");
    setFrom("");
    setTo("");
    setFlagged("");
    go({});
  }, [go]);

  const data = page.ok ? page.data : undefined;

  const pages =
    data === undefined ? 1 : Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)));

  /* Page with applied filters, not current control text, so an unsubmitted edit cannot silently change the
     result set. */
  const pageQuery = (target: number): string => responsePageLink(formId, filters, target);

  return (
    <section
      aria-labelledby="qcms-responses-heading"
      className="flex flex-col gap-4"
      data-testid="qcms-response-browser"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="qcms-responses-heading" className="text-lg font-semibold text-(--color-text)">
          {t("ops.responses.heading")}
        </h2>
        {data !== undefined && (
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-responses-total">
            {tPlural("ops.responses.total.one", "ops.responses.total.other", data.total)}
          </p>
        )}
      </div>

      <div
        role="group"
        aria-label={t("ops.responses.filters")}
        className="flex flex-wrap items-end gap-3"
        data-testid="qcms-response-filters"
      >
        <Select
          label={t("ops.responses.filter.version")}
          value={version}
          items={[
            { label: t("ops.responses.filter.anyVersion"), value: "" },
            ...(versions ?? []).map((entry) => ({
              label: `v${String(entry)}`,
              value: String(entry),
            })),
          ]}
          onChange={setVersion}
        />
        <DatePicker
          label={t("ops.responses.filter.from")}
          description={t("ops.responses.filter.dayHint", { zone: dayZone })}
          granularity="day"
          value={from}
          onChange={setFrom}
        />
        <DatePicker
          label={t("ops.responses.filter.to")}
          description={t("ops.responses.filter.dayHint", { zone: dayZone })}
          granularity="day"
          value={to}
          onChange={setTo}
        />
        <Select
          label={t("ops.responses.filter.flagged")}
          value={flagged}
          items={[
            { label: t("ops.responses.filter.anyFlag"), value: "" },
            { label: t("ops.responses.filter.onlyFlagged"), value: "true" },
            { label: t("ops.responses.filter.onlyClean"), value: "false" },
          ]}
          onChange={setFlagged}
        />
        <Button variant="secondary" size="md" isDisabled={isPending} onPress={apply}>
          {t("ops.responses.filter.apply")}
        </Button>
        <Button variant="ghost" size="md" isDisabled={isPending} onPress={clear}>
          {t("ops.responses.filter.clear")}
        </Button>
        <HeadingMarker control="responses.export">
          <Button
            variant="primary"
            size="md"
            isDisabled={operatorZone === null}
            onPress={() => {
              setExporting(true);
            }}
          >
            {t("ops.export.open")}
          </Button>
        </HeadingMarker>
      </div>

      {data !== undefined &&
        (data.responses.length === 0 ? (
          <EmptyState
            heading={hasFilters ? t("ops.responses.filteredEmpty") : t("ops.responses.emptyTitle")}
            body={hasFilters ? undefined : t("ops.responses.empty")}
            testId="qcms-responses-empty"
          />
        ) : (
          <div className="qcms-table">
            <table data-testid="qcms-responses-table">
              <caption className="qcms-visually-hidden">{t("ops.responses.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ops.responses.column.sessionId")}</th>
                  <th scope="col" className="qcms-cell--num">
                    {t("ops.responses.column.version")}
                  </th>
                  <th scope="col" className="qcms-cell--num">
                    {t("ops.responses.column.submittedAt")}
                  </th>
                  <th scope="col">{t("ops.responses.column.access")}</th>
                  <th scope="col">{t("ops.responses.column.flag")}</th>
                  <th scope="col" className="qcms-cell--drop">
                    {t("ops.responses.column.preview")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.responses.map((row) => (
                  <tr key={row.sessionId} data-session-id={row.sessionId}>
                    <th scope="row">
                      <EntityId
                        kind="session"
                        value={row.sessionId}
                        href={`${base}/${encodeURIComponent(row.sessionId)}`}
                        linkLabel={(shown) =>
                          t("ops.responses.open", { shownId: shown, sessionId: row.sessionId })
                        }
                      />
                    </th>
                    <td className="qcms-cell--num">v{row.formVersion}</td>
                    <td className="qcms-cell--num">
                      <OperatorDateTime iso={row.submittedAt} fallback={t("ops.common.none")} />
                    </td>
                    <td>{t(`ops.responses.access.${row.accessMode}`)}</td>
                    <td>
                      <FlagTag flagged={row.flaggedReason !== null} />
                    </td>
                    <td className="qcms-cell--drop">
                      <span className="qcms-answer-preview" data-testid="qcms-answer-preview">
                        {answerPreviewText(row.answers)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {data !== undefined && pages > 1 && (
        <nav
          aria-label={t("ops.responses.heading")}
          className="flex flex-wrap items-center gap-3"
          data-testid="qcms-responses-paging"
        >
          {data.page > 1 && (
            <Link className="qcms-text-link" href={pageQuery(data.page - 1)}>
              {t("ops.responses.previous")}
            </Link>
          )}
          <span className="text-sm text-(--color-text-muted)">
            {t("ops.responses.pageOf", { page: data.page, pages })}
          </span>
          {data.page < pages && (
            <Link className="qcms-text-link" href={pageQuery(data.page + 1)}>
              {t("ops.responses.next")}
            </Link>
          )}
        </nav>
      )}

      {exporting && (
        <ExportDialog
          formId={formId}
          versions={versions}
          initialVersion={handedOff?.["version"] ?? version}
          initialFrom={handedOff?.["from"] ?? from}
          initialTo={handedOff?.["to"] ?? to}
          initialFormat={asExportFormat(handedOff?.["format"])}
          initialShape={asExportShape(handedOff?.["shape"])}
          initialZone={draftZone}
          operatorZone={operatorZone}
          onClose={() => {
            setExporting(false);
          }}
        />
      )}
    </section>
  );
}

function asExportFormat(value: string | undefined): ExportFormat | undefined {
  return value === "csv" || value === "json" ? value : undefined;
}

function asExportShape(value: string | undefined): ExportShape | undefined {
  return value === "long" || value === "wide" ? value : undefined;
}

function shapeHint(format: ExportFormat, shape: ExportShape): string {
  if (!shapeApplies(format)) return t("ops.export.shapeIgnored");
  return shape === "wide" ? t("ops.export.shapeWideHint") : t("ops.export.shapeLongHint");
}

function ExportDialog({
  formId,
  versions,
  initialVersion,
  initialFrom,
  initialTo,
  initialFormat,
  initialShape,
  initialZone,
  operatorZone,
  onClose,
}: {
  readonly formId: string;
  readonly versions: readonly number[] | undefined;
  readonly initialVersion: string;
  readonly initialFrom: string;
  readonly initialTo: string;
  readonly initialFormat?: ExportFormat | undefined;
  readonly initialShape?: ExportShape | undefined;
  readonly initialZone: string | null;
  readonly operatorZone: string | null;
  readonly onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat ?? "csv");
  const [shape, setShape] = useState<ExportShape>(initialShape ?? DEFAULT_EXPORT_SHAPE);
  const [version, setVersion] = useState(initialVersion);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const timeZone = from === initialFrom && to === initialTo ? initialZone : operatorZone;
  const choice: ExportChoice = {
    format,
    version,
    from,
    to,
    shape,
    ...(timeZone === null ? {} : { timeZone }),
  };
  const dayHint = t("ops.export.dayHint", { zone: timeZone ?? t("ops.common.yourZone") });
  const needsVersion = versionRequired(format);
  const needsShape = shapeApplies(format);
  // An unknown version list does not block the formats that need no version: JSON records
  // carry their own, so the only thing a failed version read costs is a CSV export.
  const ready = isExportable(choice) && (versions === undefined || versions.length > 0);

  return (
    <Dialog
      isOpen
      title={t("ops.export.title")}
      isDismissable
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <div className="flex flex-col gap-4" data-testid="qcms-export-dialog">
        <Select
          label={t("ops.export.format")}
          value={format}
          items={[
            { label: t("ops.export.csv"), value: "csv" },
            { label: t("ops.export.json"), value: "json" },
          ]}
          onChange={(next) => {
            setFormat(next === "json" ? "json" : "csv");
          }}
        />
        <Select
          label={t("ops.export.shape")}
          value={shape}
          isDisabled={!needsShape}
          description={shapeHint(format, shape)}
          items={[
            { label: t("ops.export.shapeLong"), value: "long" },
            { label: t("ops.export.shapeWide"), value: "wide" },
          ]}
          onChange={(next) => {
            setShape(next === "wide" ? "wide" : "long");
          }}
        />
        <Select
          label={t("ops.export.version")}
          value={version}
          isDisabled={!needsVersion}
          description={
            needsVersion ? t("ops.export.versionRequired") : t("ops.export.versionIgnored")
          }
          placeholder={t("ops.export.pickVersion")}
          items={(versions ?? []).map((entry) => ({
            label: `v${String(entry)}`,
            value: String(entry),
          }))}
          onChange={setVersion}
        />
        <DatePicker
          label={t("ops.export.from")}
          description={dayHint}
          granularity="day"
          value={from}
          onChange={setFrom}
        />
        <DatePicker
          label={t("ops.export.to")}
          description={dayHint}
          granularity="day"
          value={to}
          onChange={setTo}
        />
        {versions === undefined && (
          <p
            className="text-sm text-(--color-text-muted)"
            data-testid="qcms-export-unknown-versions"
          >
            {t("ops.export.versionsUnknown")}
          </p>
        )}
        {versions?.length === 0 && (
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-export-no-versions">
            {t("ops.export.noVersions")}
          </p>
        )}
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-export-empty-note">
          {t(`ops.export.emptyNote.${format}`)}
        </p>
        <div className="flex flex-wrap gap-2">
          {ready ? (
            <a
              className="qcms-button-link"
              data-testid="qcms-export-download"
              href={`/operations/forms/${encodeURIComponent(formId)}/export${exportQuery(choice)}`}
              download
              onClick={onClose}
            >
              {t("ops.export.download")}
            </a>
          ) : (
            <Button variant="primary" size="md" isDisabled>
              {t("ops.export.download")}
            </Button>
          )}
          <Button variant="ghost" size="md" onPress={onClose}>
            {t("ops.common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
