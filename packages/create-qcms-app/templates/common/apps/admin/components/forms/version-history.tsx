"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button, Select } from "@/components/kit";
import { diffDefinitions, type DiffRow } from "@/lib/forms/version-diff";
import type { FormVersionSummary } from "@/lib/forms/types";
import { formatDay } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/en";

/**
 * The published-version list and the definition diff (task 034; screen contract "version
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
      <EmptyState
        heading={t("forms.history.emptyTitle")}
        body={t("forms.history.empty")}
        testId="qcms-history-empty"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The scroll box, not the page: five stamp columns of monospace do not fit a
          390px viewport, and a table that made the page body scroll sideways would fail
          WCAG 2.2 AA SC 1.4.10 Reflow. `qcms-table` is the app's one table family
          (issue 514).

          Issue 558 gave this screen the wide cap and re-examined the box, because the
          audit had it down as a device this component added to survive `max-w-5xl`
          (`plan/admin-ux-audit.md` §3.5) and therefore as something width would retire.
          It stays, for two reasons that are both older than the cap. The `overflow-x`
          has not belonged to this component since issue 514 moved it onto `.qcms-table`,
          the family class every admin table in the app wears, so there is nothing here
          to remove that would not be a change to all of them. And the reason it was
          written was the 390px viewport rather than the cap, which is the sentence
          above: more room at 1280 does nothing for a phone. At the wide cap the box is
          simply inert on a desktop, since `overflow-x: auto` scrolls only what
          overflows.

          Issue 570 gives the box a second line of defence at phone width, which the
          sentence above had no way to ask for while the markup came from the kit: the
          three engine stamps DROP at `--bp-compact` (§2). They describe the row rather
          than identifying it, and they are the widest thing in it by a distance. Version
          and Published stay, and the Version column never drops anywhere
          (`plan/admin-mobile-stance.md`, item 5). No `min-inline-size` is declared here,
          so there is none to reset at the boundary, and with the stamps gone the scroll
          container is the fallback rather than the default experience. */}
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
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.version} data-form-version={version.version}>
                {/* The view link, folded back into the row it belongs to (issue 570).
                    It used to be a separate list under the table, because a kit table
                    cell is a string and a row holding an anchor was not something the
                    vendored component rendered. The list was a defensible workaround
                    and it is still a worse answer than the row: it repeated every
                    version number a second time, it put the control an arbitrary
                    distance from the data it acted on, and a screen reader walking the
                    table found no way out of it at all. `forms.history.view` carries
                    the accessible name so the link announces "View v3" rather than the
                    bare "v3" the cell shows, which is the same treatment the response
                    browser gives its session ids. */}
                <th scope="row" className="qcms-cell--num">
                  <Link
                    className="qcms-text-link"
                    href={`/forms/${encodeURIComponent(formId)}/versions/${String(version.version)}`}
                    aria-label={t("forms.history.view", { version: version.version })}
                  >
                    {t("forms.version.value", { version: version.version })}
                  </Link>
                </th>
                <td className="qcms-cell--num">{formatDay(version.publishedAt)}</td>
                <td className="qcms-cell--drop">{version.compilerVersion}</td>
                <td className="qcms-cell--drop">{version.a2uiSpecVersion}</td>
                <td className="qcms-cell--drop">{version.semanticsVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* An `h2`, not an `h3` (issue #540). This panel sits directly under the page's
          `<h1>` with nothing between them, so the level was skipped and the heading
          outline - the structure a screen-reader user navigates an admin screen by -
          had a hole in it. axe's `heading-order` rule reported it in every mode from
          the day issue #511 switched the rule on, and it was muted in that file's debt
          register while the fix waited for this issue; both entries are deleted with
          this change, which is what puts the compare panel back under the sweep.

          Promoted rather than given a new `h2` above it: the two content regions on
          this screen are the version table and this panel, the table is named by its
          own `<caption>`, and inventing a heading for it to make this one a legal `h3`
          would add a landmark to the outline rather than correct it. The panel's own
          `aria-labelledby` still points here, and the visual size is set by the class
          rather than by the tag, so nothing on screen moves. */}
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
      {/* THE SCROLL BOX BELOW IS FOCUSABLE, and that is WCAG 2.1.1 rather than taste
          (issue #354). `.qcms-diff` is `overflow-x: auto` and JSON lines are long, so a
          wide diff scrolls sideways - and a scroll container nothing can focus is one a
          keyboard user cannot scroll at all. It is the same defect issue #309 fixed on
          `.qcms-snippet`, one component over.

          The `role` is load-bearing rather than decoration, and it predates this:
          `aria-label` on a bare `div` is a prohibited attribute, so without a role the
          accessible name is simply dropped and axe reports `aria-prohibited-attr`.

          The axe sweep could not see any of it until the same issue gave it a fixture
          diff that actually overflows (`e2e/a11y-axe.pw.ts`). `scrollable-region-focusable`
          fires only on an element that really scrolls, so a fixture whose diff fits
          reports a green that means nothing. */}
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

/** The catalog suffix naming a row's kind, so the key stays a literal the type checks. */
function kindKey(row: DiffRow): "Added" | "Removed" | "Same" {
  if (row.kind === "added") return "Added";
  if (row.kind === "removed") return "Removed";
  return "Same";
}
