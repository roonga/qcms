"use client";

import Link from "next/link";

import type { BuilderStatus } from "@/lib/forms/autosave";
import { useBuilderRail } from "@/lib/forms/builder-bridge";
import {
  anchorFor,
  locationOf,
  messageForIssue,
  ruleForIssue,
  ruleHref,
  stepOwningAnchor,
} from "@/lib/forms/issues";
import type { DraftForm, FormIssue } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/* A failed validate is not a failed save: storage may have succeeded before the separate check failed. */
export type { BuilderStatus };

export function ValidationPanel({
  draft,
  issues,
  warnings = [],
  status,
}: {
  readonly draft: DraftForm;
  readonly issues: readonly FormIssue[] | undefined;
  readonly warnings?: readonly FormIssue[];
  readonly status: BuilderStatus;
}) {
  return (
    <section
      aria-labelledby="qcms-validation-heading"
      className="flex flex-col gap-3 rounded-md border border-(--color-border) bg-(--color-background-muted) p-4"
    >
      <h2 id="qcms-validation-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.validation.title")}
      </h2>

      <p
        aria-live="polite"
        className="flex flex-col gap-1 text-sm text-(--color-text-muted)"
        data-testid="qcms-validation-status"
      >
        <span data-testid="qcms-issue-summary">{issueSummary(issues, status)}</span>
      </p>

      {issues !== undefined && issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${locationOf(issue)}:${String(index)}`}>
              <IssueEntry issue={issue} draft={draft} />
            </li>
          ))}
        </ul>
      )}

      {/* Warnings stay outside the authoritative issue count and its live region because they do not block
   publishing. */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="qcms-validation-warnings">
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("forms.warning.heading")}
          </h3>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-warning-summary">
            {warningSummary(warnings)}
          </p>
          <ul className="flex flex-col gap-2">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}:${locationOf(warning)}:${String(index)}`}>
                <IssueEntry issue={warning} draft={draft} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function issueSummary(issues: readonly FormIssue[] | undefined, status: BuilderStatus): string {
  if (status === "validating") return t("forms.validation.checking");
  // Check validation failure before the count; no successful verdict means no count to report.
  if (status === "error") return t("forms.validation.unchecked");
  if (issues === undefined) return t("forms.validation.notChecked");
  const count = issues.length;
  if (count === 0) return t("forms.validation.none");
  if (count === 1) return t("forms.validation.countOne");
  return t("forms.validation.count", { count });
}

function warningSummary(warnings: readonly FormIssue[]): string {
  return warnings.length === 1
    ? t("forms.warning.countOne")
    : t("forms.warning.count", { count: warnings.length });
}

export function IssueEntry({
  issue,
  draft,
}: {
  readonly issue: FormIssue;
  readonly draft: DraftForm;
}) {
  const anchor = anchorFor(issue, draft);
  const builder = useBuilderRail();
  const where = locationOf(issue);
  const rule = ruleForIssue(issue, draft);
  const body = (
    <>
      <span className="block text-sm text-(--color-text)">{messageForIssue(issue)}</span>
      <span className="block text-xs text-(--color-text-muted)">
        {where === "" ? issue.message : `${where} - ${issue.message}`}
      </span>
    </>
  );

  if (anchor === undefined) return <div data-issue-code={issue.code}>{body}</div>;

  if (rule !== undefined) {
    return (
      <Link
        href={ruleHref(draft.formId, rule)}
        data-issue-code={issue.code}
        className="qcms-text-link block"
      >
        {body}
      </Link>
    );
  }

  return (
    <a
      href={`#${anchor}`}
      data-issue-code={issue.code}
      className="qcms-text-link block"
      onClick={(event) => {
        const target = document.getElementById(anchor);
        if (target !== null) {
          event.preventDefault();
          focusAnchor(target);
          return;
        }

        if (builder === undefined) return;
        const stepId = stepOwningAnchor(issue, draft);
        if (stepId === undefined) return;
        event.preventDefault();
        builder.choose(stepId);
        focusWhenRendered(anchor);
      }}
    >
      {body}
    </a>
  );
}

function focusAnchor(target: HTMLElement): void {
  target.scrollIntoView({ block: "nearest" });
  target.focus();
}

/* Retry focus for a bounded number of frames while the selected panel mounts; never loop if the target was
   deleted. */
function focusWhenRendered(anchor: string, attemptsLeft = 3): void {
  requestAnimationFrame(() => {
    const target = document.getElementById(anchor);
    if (target !== null) {
      focusAnchor(target);
      return;
    }
    if (attemptsLeft > 0) focusWhenRendered(anchor, attemptsLeft - 1);
  });
}
