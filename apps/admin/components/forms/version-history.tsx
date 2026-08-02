"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Select, Table } from "@/components/kit";
import { diffDefinitions, type DiffRow } from "@/lib/forms/version-diff";
import type { FormVersionSummary } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The published-version list and the definition diff (task 034; wireframe "version
 * history").
 *
 * ## Immutability, made visible
 *
 * The table is the audit record: every version, when it was frozen, and the three stamps
 * that say which engine froze it (`compilerVersion`, `a2uiSpecVersion`,
 * `semanticsVersion`). Those columns are not trivia - they are what makes ADR-18's promise
 * checkable, because they name the exact renderer generation a stored document was
 * compiled for.
 *
 * ## Why the diff is here and the render is a route
 *
 * Comparing two definitions is a pure client-side read of data the page already has, so it
 * happens in place. Viewing a version renders its **stored compiled documents**, which is
 * a separate read of a separate resource, so it is its own address. That split also keeps
 * the promise exit criterion 4 checks: nothing on this screen or the version screen ever
 * calls the draft-preview endpoint, because history shows the audit copy and a
 * recompilation would be a different document.
 */
export function VersionHistory({
  formId,
  versions,
  definitionsByVersion,
}: {
  readonly formId: string;
  /** Newest first, as the detail read returns them. */
  readonly versions: readonly FormVersionSummary[];
  /** The frozen definition of each version, for the diff. Keyed by version number. */
  readonly definitionsByVersion: Readonly<Record<string, unknown>>;
}) {
  const [older, setOlder] = useState<string>("");
  const [newer, setNewer] = useState<string>("");

  const items = versions.map((version) => ({
    value: String(version.version),
    label: t("forms.version.value", { version: version.version }),
  }));

  const diff = useMemo(() => {
    if (older === "" || newer === "" || older === newer) return undefined;
    return diffDefinitions(definitionsByVersion[older], definitionsByVersion[newer]);
  }, [older, newer, definitionsByVersion]);

  if (versions.length === 0) {
    return (
      <p className="text-sm text-(--color-text-muted)" data-testid="qcms-history-empty">
        {t("forms.history.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Table
        ariaLabel={t("forms.history.table")}
        columns={[
          { id: "version", label: t("forms.history.column.version"), isRowHeader: true },
          { id: "publishedAt", label: t("forms.history.column.publishedAt") },
          { id: "compilerVersion", label: t("forms.history.column.compilerVersion") },
          { id: "a2uiSpecVersion", label: t("forms.history.column.a2uiSpecVersion") },
          { id: "semanticsVersion", label: t("forms.history.column.semanticsVersion") },
        ]}
        rows={versions.map((version) => ({
          id: String(version.version),
          data: {
            version: t("forms.version.value", { version: version.version }),
            publishedAt: version.publishedAt,
            compilerVersion: version.compilerVersion,
            a2uiSpecVersion: version.a2uiSpecVersion,
            semanticsVersion: version.semanticsVersion,
          },
        }))}
      />

      {/* The view links live outside the table because a kit table cell is text: a row
          holding an anchor is not something the vendored component renders (ADR-22, no
          wrappers). A list of links is also the better keyboard surface - every version
          is reachable by Tab, with its number in the link text. */}
      <ul className="flex flex-wrap gap-2" data-testid="qcms-history-links">
        {versions.map((version) => (
          <li key={version.version}>
            <Link
              className="qcms-text-link"
              href={`/forms/${encodeURIComponent(formId)}/versions/${String(version.version)}`}
            >
              {t("forms.history.view", { version: version.version })}
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="qcms-diff-heading" className="flex flex-col gap-3">
        <h3 id="qcms-diff-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.history.compare")}
        </h3>
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
            {t("forms.preview.reset")}
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

/** The one-line description of what the diff found. */
function diffSummary(diff: ReturnType<typeof diffDefinitions>): string {
  if (diff.tooLarge) return t("forms.history.compareTooLarge");
  if (diff.identical) return t("forms.history.compareIdentical");
  return t("forms.history.compareCounts", { added: diff.added, removed: diff.removed });
}

/**
 * The side-by-side diff.
 *
 * Each row carries its `+`/`-` marker as text and its kind as a visually-hidden word, so
 * the diff is readable with colour off, in high contrast, and by a screen reader. The
 * tints are the secondary signal only (WCAG 1.4.1).
 */
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
        <div className="qcms-diff" role="group" aria-label={summary}>
          <ol className="qcms-diff-rows">
            {rows.map((row, index) => (
              <li key={index} className={`qcms-diff-row qcms-diff-row--${row.kind}`}>
                <span className="qcms-visually-hidden">{t(`forms.history.compareRow${kindKey(row)}`)}</span>
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

/** The catalog suffix naming a row's kind, so the key stays a literal the type checks. */
function kindKey(row: DiffRow): "Added" | "Removed" | "Same" {
  if (row.kind === "added") return "Added";
  if (row.kind === "removed") return "Removed";
  return "Same";
}
