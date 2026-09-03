"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button, DatePicker, Dialog, Select } from "@/components/kit";
import { FlagTag } from "@/components/ops/ops-tags";
import { answerPreviewText } from "@/lib/ops/answers";
import type { AppliedFilters } from "@/lib/ops/browse";
import { responsePageLink } from "@/lib/ops/browse";
import type { ExportChoice, ExportFormat } from "@/lib/ops/export";
import { exportQuery, isExportable, versionRequired } from "@/lib/ops/export";
import type { ResponsePage } from "@/lib/ops/types";
import { OperatorDateTime } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

/**
 * The response browser: filter, page, open, export (task 035; screen contract "browser
 * toolbar", "browser `table`").
 *
 * ## Filtering is a navigation, not client state
 *
 * The toolbar pushes a query string and the **server** re-reads the page. That is not
 * a stylistic choice: the filters are the API's (`?version=&from=&to=&flagged=`) and
 * the paging is the API's too, so a client-side filter would have to either fetch the
 * whole set (unbounded - this is the one screen that grows with respondent volume) or
 * silently filter one page and mislabel the count. Pushing the query means the URL is
 * the filter state: it is shareable, it survives a reload, and the back button undoes
 * a filter the way an operator expects.
 *
 * ## The export is an anchor, not a fetch
 *
 * `<a href download>` hands the transfer to the browser, so a large export streams to
 * disk instead of being buffered into this tab's memory as a blob first. It also
 * works with scripting disabled, and it keeps answer values out of the client bundle's
 * hands entirely: nothing in this component ever holds the exported bytes.
 *
 * ## A failed read is not an empty page
 *
 * `page` is a `ReadState` rather than a `ResponsePage` (issues 543 and 572), so this
 * component can tell "the list did not load" from "the list is empty". It used to be
 * handed `ok ? data : { responses: [], total: 0, ... }`, which meant a failed read
 * printed the §3 empty panel and "0 responses" underneath the page's own alert saying
 * the responses could not be loaded: an all-clear about data that never arrived, which
 * is the same untruth issue 521 fixed one derivation over.
 *
 * What survives a failure is the split `plan/admin-design-contracts.md` §3 asks for, and
 * `lib/read-state.ts` leaves to each component. Suppressed: the count, the table, the
 * empty panel and the pager, because every one of them is a claim about rows that were
 * not read, and the pager's own page count is computed from a total nobody supplied.
 * Kept: the heading (the alert above needs a subject, and a heading claims nothing) and
 * the whole toolbar, because filtering is a navigation that triggers a FRESH read - it
 * is the retry an operator reaches for - and Export is a separate request that can
 * succeed while the list read did not.
 */
export function ResponseBrowser({
  formId,
  page,
  versions,
  filters,
  hasFilters,
}: {
  readonly formId: string;
  readonly page: ReadState<ResponsePage>;
  /** The form's published versions, newest first, for the two version controls. */
  readonly versions: readonly number[];
  /** What the server actually applied, which is also what a page link carries. */
  readonly filters: AppliedFilters;
  /** Whether any filter is applied, which decides which empty message is true. */
  readonly hasFilters: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The controls are a DRAFT of the next filter set. `filters` is what the server
  // actually applied, and the two are not the same thing the moment an operator types
  // without pressing Apply.
  const [version, setVersion] = useState(filters.version);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [flagged, setFlagged] = useState(filters.flagged);
  const [exporting, setExporting] = useState(false);

  // Re-seed the draft whenever the APPLIED set changes under it. `useState` reads its
  // initializer once, so back/forward navigation (and the push below) re-rendered this
  // component with new props and left the controls showing the previous filter set -
  // controls that disagree with the table beside them. Keying off a serialization of
  // the applied set rather than an effect keeps it a render-time derivation, which is
  // what it is: no effect, no flash of the stale value.
  const applied = `${filters.version}|${filters.from}|${filters.to}|${filters.flagged}`;
  const [seeded, setSeeded] = useState(applied);
  if (seeded !== applied) {
    setSeeded(applied);
    setVersion(filters.version);
    setFrom(filters.from);
    setTo(filters.to);
    setFlagged(filters.flagged);
  }

  const base = `/forms/${encodeURIComponent(formId)}/responses`;

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
    // Page is deliberately dropped: a new filter set has a new page 1, and keeping
    // page 4 would land the operator on an empty page and read as "no matches".
    go({ version, from, to, flagged });
  }, [go, version, from, to, flagged]);

  const clear = useCallback(() => {
    setVersion("");
    setFrom("");
    setTo("");
    setFlagged("");
    go({});
  }, [go]);

  // The rows, or nothing at all if the read failed. Every use below is guarded on it,
  // which is the point of the union: there is no empty page to mistake for an answer.
  const data = page.ok ? page.data : undefined;

  const pages =
    data === undefined ? 1 : Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)));

  /**
   * A link to another page of the CURRENT result set.
   *
   * Delegated to `lib/ops/browse.ts` so it is built from `filters` - what the server
   * applied - and cannot reach the draft state above: the module takes the applied set
   * as an argument and has no other filters in scope. Building it from the controls
   * meant a date typed into "From" and never applied rode along with a "Next page"
   * click, so the operator asked to page through the results they were looking at and
   * silently got a different query, with the count and the page number they had just
   * read no longer describing anything.
   */
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
            ...versions.map((entry) => ({ label: `v${String(entry)}`, value: String(entry) })),
          ]}
          onChange={setVersion}
        />
        <DatePicker
          label={t("ops.responses.filter.from")}
          description={t("ops.responses.filter.dayHint")}
          granularity="day"
          value={from}
          onChange={setFrom}
        />
        <DatePicker
          label={t("ops.responses.filter.to")}
          description={t("ops.responses.filter.dayHint")}
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
        <Button
          variant="primary"
          size="md"
          onPress={() => {
            setExporting(true);
          }}
        >
          {t("ops.export.open")}
        </Button>
      </div>

      {/* `plan/admin-design-contracts.md` §3's panel, both variants. Filtered keeps
          the panel and swaps the heading to this screen's own "no matches" line with
          no sentence under it; unfiltered keeps the sentence. Neither carries a CTA:
          responses are created by respondents, so there is no creating action on this
          screen for §3's CTA clause to offer, and the filters are the form directly
          above with its own reset control. */}
      {data !== undefined &&
        (data.responses.length === 0 ? (
          <EmptyState
            heading={hasFilters ? t("ops.responses.filteredEmpty") : t("ops.responses.emptyTitle")}
            body={hasFilters ? undefined : t("ops.responses.empty")}
            testId="qcms-responses-empty"
          />
        ) : (
          /* One table family (`plan/admin-design-contracts.md` §2). The wrapper is the
           scroll box, the positioning region for the row chrome, and the styling hook;
           the `<table>` is a plain table again.

           WHICH COLUMN DROPS AT COMPACT WIDTH (§2): the answer preview, and only it.
           Session, Version, Submitted, Access and Flag are how an operator FINDS a
           response; the preview only helps them recognise it once found, and it is the
           widest column by a distance. Version never drops anywhere
           (`plan/admin-mobile-stance.md`, item 5). Below the boundary this is exactly
           the five-column table that shipped before issue 515, so the sixth column
           costs no sideways scrolling at a phone width at all. */
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
                      <Link
                        className="qcms-text-link"
                        href={`${base}/${encodeURIComponent(row.sessionId)}`}
                        aria-label={t("ops.responses.open", { sessionId: row.sessionId })}
                      >
                        <code className="qcms-link-id">{row.sessionId}</code>
                      </Link>
                    </th>
                    <td className="qcms-cell--num">v{row.formVersion}</td>
                    <td className="qcms-cell--num">
                      <OperatorDateTime iso={row.submittedAt} fallback={t("ops.common.none")} />
                    </td>
                    <td>{t(`ops.responses.access.${row.accessMode}`)}</td>
                    <td>
                      <FlagTag flagged={row.flaggedReason !== null} />
                    </td>
                    {/*
                    The answer preview (issue 515; the screen contract's sixth column). Real
                    respondent data by definition, so the cell shows exactly what
                    `answerPreviewText` allows and nothing more: two answered questions,
                    each value clipped to a character budget before it becomes text.

                    There is deliberately NO `title` tooltip carrying the full answer.
                    That would put the untruncated value straight back into the markup
                    and make the budget decorative, and reading a response in full is the
                    detail screen's job - reached through this row's own identifying
                    cell, which is the authorised, audited act. Nothing on this path logs
                    an answer value either (SEC-13): the only place one goes is the text
                    node below.
                  */}
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
          initialVersion={version}
          initialFrom={from}
          initialTo={to}
          onClose={() => {
            setExporting(false);
          }}
        />
      )}
    </section>
  );
}

/**
 * The export dialog (screen contract "export UI").
 *
 * The version control is **disabled with a hint** for JSON rather than hidden, so the
 * two formats' controls stay in the same place and the reason the control is inert is
 * on screen instead of being inferred from its disappearance. The download button is
 * disabled until the choice is one the API will accept (`isExportable`), which is the
 * same predicate the unit tests hold the rule to.
 */
function ExportDialog({
  formId,
  versions,
  initialVersion,
  initialFrom,
  initialTo,
  onClose,
}: {
  readonly formId: string;
  readonly versions: readonly number[];
  readonly initialVersion: string;
  readonly initialFrom: string;
  readonly initialTo: string;
  readonly onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [version, setVersion] = useState(initialVersion);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const choice: ExportChoice = { format, version, from, to };
  const needsVersion = versionRequired(format);
  const ready = isExportable(choice) && versions.length > 0;

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
          label={t("ops.export.version")}
          value={version}
          isDisabled={!needsVersion}
          description={
            needsVersion ? t("ops.export.versionRequired") : t("ops.export.versionIgnored")
          }
          placeholder={t("ops.export.pickVersion")}
          items={versions.map((entry) => ({ label: `v${String(entry)}`, value: String(entry) }))}
          onChange={setVersion}
        />
        <DatePicker
          label={t("ops.export.from")}
          description={t("ops.export.dayHint")}
          granularity="day"
          value={from}
          onChange={setFrom}
        />
        <DatePicker
          label={t("ops.export.to")}
          description={t("ops.export.dayHint")}
          granularity="day"
          value={to}
          onChange={setTo}
        />
        {versions.length === 0 && (
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
              href={`/forms/${encodeURIComponent(formId)}/export${exportQuery(choice)}`}
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
