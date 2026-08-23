"use client";

import { anchorFor, locationOf, messageForIssue } from "@/lib/forms/issues";
import type { DraftForm, FormIssue } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The live validation panel (task 033; screen contract "validation panel").
 *
 * ## This panel counts issues and says nothing about saving (issue 518)
 *
 * It used to do both: 033 put the save indicator's sentence in the same live region as the
 * issue count, and design-language element 7 objects to exactly that placement. The save
 * state now lives in the builder's ambient chrome (`components/save-model.tsx`), and this
 * panel keeps the job `plan/admin-ux-audit.md` §5.6 gives it - being the **single
 * authoritative issue count** on the screen. That authority is why the split has to be
 * clean in both directions: nothing here mentions saving, and nothing in the strip counts
 * anything. Two things that both read as "status" on one screen is how a reader ends up
 * doing arithmetic they cannot check.
 *
 * Two of the builder's statuses are still read here, and both are about issues rather than
 * storage, because the validate round trip is a second call that decides what the count
 * *is*. `"validating"` is this panel reporting that its own number is being refreshed;
 * `"error"` is it reporting that the refresh did not land. Neither says anything about
 * whether the draft was stored - the ambient strip owns that, and it is right to keep
 * saying "Saved" through a failed validate, because the draft genuinely is saved.
 *
 * ## A failed check is stated here, not left silent
 *
 * The panel used to render `"error"` as "The last save failed.", which was false: the
 * draft is stored before `status` becomes `"validating"`. Removing that was correct, but
 * removing it without a replacement was worse than the lie it removed. With no consumer
 * for `"error"`, a failed validate rendered as *"No issues. Everything here would pass a
 * publish."* beside the Publish button, because the API supplies an empty issue list for
 * any failure that is not a 422 - so the count was not stale, it was reset, and the panel
 * asserted an all-clear at the one moment it knew least. §5.6 makes this panel the single
 * authority on the count, and an authority that cannot refresh owes the author that fact
 * rather than a confident zero. The sentence stays in issue vocabulary and carries no save
 * state, so the split with the strip holds in both directions.
 *
 * ## A check that has not run yet is a third thing, and it is the common one (issue 625)
 *
 * The argument above was written about `"error"` and it applies unchanged one door along.
 * The builder seeds its issue list empty and only talks to the API once the author has
 * changed something, so opening a form and touching nothing rendered the all-clear beside
 * the Publish button on a draft nothing had ever validated. On the seeded insurance form,
 * whose two pins name versions that were never published, the API's dry run reports two
 * issues and the §7 rail badges them on the other seven form screens - while this panel,
 * the one §5.6 makes authoritative, said there were none.
 *
 * So the absence of a verdict is now a value rather than an empty list: `issues` is
 * `undefined` until a check lands, and that is the state this panel reports. It is a
 * separate sentence from `"error"` on purpose. "The check did not land" is something an
 * author can act on and "the check has not run" is not, and collapsing them would tell
 * someone their draft failed a check nobody attempted.
 *
 * **`status` cannot carry this fact**, which is why the absence lives on `issues`. The
 * builder sets `status` to `"saving"` the moment anything is touched, so a panel keyed on
 * `"idle"` would go back to announcing the all-clear for the whole of the first debounce
 * and round trip: the same fabricated zero, one keystroke later.
 *
 * Every entry is a **link that moves focus**, which is the whole reason the API's issues
 * carry a structured domain path rather than a positional index: `{ rule: "rul_x" }` is an
 * address the builder can resolve to a DOM id it owns, so "your rule targets a question
 * that comes earlier" can put the author's cursor on that rule instead of asking them to
 * go and find it. An entry whose target is not rendered (a `DANGLING_QUESTION_REF` naming
 * a question that is by definition not pinned anywhere) renders as text rather than as a
 * link to nothing. Nothing is ever dropped.
 *
 * The count sits in an `aria-live="polite"` region, per the screen contract's a11y note. The
 * **summary only**, never the list: re-announcing twelve sentences every time a debounce
 * lands would make the panel unusable with a screen reader, while "3 issues would block a
 * publish" is the change an author actually needs to hear.
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
}: {
  readonly draft: DraftForm;
  /** The verdict, or `undefined` when no check has landed yet. Never a stand-in for zero. */
  readonly issues: readonly FormIssue[] | undefined;
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

      {/* Testid on the region as well as on its sentence, so the `aria-live` can be
          asserted directly (#368): the span is attached and carries its text whether or
          not the paragraph around it is still a live region. */}
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
    </section>
  );
}

/** What the draft's issues add up to, in one sentence. */
function issueSummary(issues: readonly FormIssue[] | undefined, status: BuilderStatus): string {
  if (status === "validating") return t("forms.validation.checking");
  // A failed round trip is reported here, and the order matters: `"error"` has to be
  // read BEFORE the count, because the count on that path is not a count. The API
  // supplies an empty issue list for any failure that is not a 422 carrying
  // `details.issues`, so falling through to the count branches renders the all-clear
  // sentence at the exact moment the app knows least - beside the Publish button.
  if (status === "error") return t("forms.validation.unchecked");
  // No verdict at all, which is neither a count nor a failure. Read before the count
  // branches for the same reason `"error"` is: there is no number here to fall through to.
  if (issues === undefined) return t("forms.validation.notChecked");
  const count = issues.length;
  if (count === 0) return t("forms.validation.none");
  if (count === 1) return t("forms.validation.countOne");
  return t("forms.validation.count", { count });
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
