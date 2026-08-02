"use client";

import { anchorFor, locationOf, messageForIssue } from "@/lib/forms/issues";
import type { DraftForm, FormIssue } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The live validation panel and the save indicator (task 033; wireframe "validation
 * panel" plus the header's save indicator).
 *
 * Every entry is a **link that moves focus**, which is the whole reason the API's issues
 * carry a structured domain path rather than a positional index: `{ rule: "rul_x" }` is an
 * address the builder can resolve to a DOM id it owns, so "your rule targets a question
 * that comes earlier" can put the author's cursor on that rule instead of asking them to
 * go and find it. An entry whose target is not rendered (a `DANGLING_QUESTION_REF` naming
 * a question that is by definition not pinned anywhere) renders as text rather than as a
 * link to nothing. Nothing is ever dropped.
 *
 * The count and the save state share one `aria-live="polite"` region, per the wireframe's
 * a11y note. The **summary only**, never the list: re-announcing twelve sentences every
 * time a debounce lands would make the panel unusable with a screen reader, while "3
 * issues would block a publish" is the change an author actually needs to hear.
 *
 * `href="#id"` **and** a click handler, not one or the other. The href makes it a real
 * link - announced as a link, middle-clickable, meaningful before hydration - and the
 * handler adds the focus move that a bare fragment navigation does not reliably make.
 */
export type BuilderStatus = "idle" | "validating" | "saved" | "saving" | "error";

export function ValidationPanel({
  draft,
  issues,
  status,
  lastSavedAt,
}: {
  readonly draft: DraftForm;
  readonly issues: readonly FormIssue[];
  readonly status: BuilderStatus;
  /** A locale-formatted clock time, or `undefined` before the first save of this visit. */
  readonly lastSavedAt: string | undefined;
}) {
  return (
    <section
      aria-labelledby="qcms-validation-heading"
      className="flex flex-col gap-3 rounded-md border border-(--color-border) bg-(--color-background-muted) p-4"
    >
      <h2 id="qcms-validation-heading" className="text-base font-semibold text-(--color-text)">
        {t("forms.validation.title")}
      </h2>

      <p aria-live="polite" className="flex flex-col gap-1 text-sm text-(--color-text-muted)">
        <span data-testid="qcms-issue-summary">{issueSummary(issues.length, status)}</span>
        <span data-testid="qcms-save-state">{saveSummary(status, lastSavedAt)}</span>
      </p>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${locationOf(issue)}:${String(index)}`}>
              <IssueEntry issue={issue} draft={draft} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the draft's issues add up to, in one sentence. */
function issueSummary(count: number, status: BuilderStatus): string {
  if (status === "validating") return t("forms.validation.checking");
  if (count === 0) return t("forms.validation.none");
  if (count === 1) return t("forms.validation.countOne");
  return t("forms.validation.count", { count });
}

/** Where the autosave has got to, in one sentence. */
function saveSummary(status: BuilderStatus, lastSavedAt: string | undefined): string {
  if (status === "saving") return t("forms.save.saving");
  if (status === "error") return t("forms.save.failed");
  if (lastSavedAt !== undefined) return t("forms.save.saved", { time: lastSavedAt });
  return t("forms.save.idle");
}

/**
 * One issue, rendered as a link into the builder when its path resolves to something on
 * screen and as plain text when it does not.
 *
 * Exported because 034's publish-rejection list is the same object in a different place:
 * the issues a publish refuses on are the issues validate reports, and an author should
 * not meet two different renderings of the same sentence depending on which button they
 * pressed.
 */
export function IssueEntry({
  issue,
  draft,
}: {
  readonly issue: FormIssue;
  readonly draft: DraftForm;
}) {
  const anchor = anchorFor(issue, draft);
  const where = locationOf(issue);
  const body = (
    <>
      <span className="block text-sm text-(--color-text)">{messageForIssue(issue)}</span>
      <span className="block text-xs text-(--color-text-muted)">
        {where === "" ? issue.message : `${where} - ${issue.message}`}
      </span>
    </>
  );

  if (anchor === undefined) return <div data-issue-code={issue.code}>{body}</div>;

  return (
    <a
      href={`#${anchor}`}
      data-issue-code={issue.code}
      className="qcms-text-link block"
      onClick={(event) => {
        const target = document.getElementById(anchor);
        if (target === null) return;
        event.preventDefault();
        target.scrollIntoView({ block: "nearest" });
        target.focus();
      }}
    >
      {body}
    </a>
  );
}
