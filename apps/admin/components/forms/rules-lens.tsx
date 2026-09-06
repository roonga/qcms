"use client";

import Link from "next/link";

import { issuesForRule, NEW_RULE_HASH, ruleHref, rulesHref } from "@/lib/forms/issues";
import { ruleSentence, type RuleSentenceSegment } from "@/lib/forms/rule-sentence";
import { issueCountLabel, RAIL_PREFETCH } from "@/lib/forms/subtree-rail";
import type { DraftForm, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

/**
 * The builder's rules card: a compact READ-ONLY lens onto a screen that lives elsewhere
 * (Code Owner, 2026-09-05, issue #669).
 *
 * ## What it is, and what it deliberately is not
 *
 * `plan/admin-shell-poc/admin-shell-poc.html` draws the builder's Rules card as a short
 * list of rule sentences with a digest, a note about what is being listed, and a footer of
 * two ways through: "Edit rules" and "+ Add rule". It has never drawn an editor there -
 * that is `rules-screen-poc.html`, and issue #669 is the ruling that builds it as drawn.
 * So this card states what the form's rules ARE and offers no way to change one in place.
 *
 * ## Every affordance still lands, and that is the constraint the ruling attached
 *
 * The audit's objection to a route split (`plan/admin-ux-audit.md` §5.5) was that anything
 * resolving against ids on the builder page would silently stop resolving. Nothing here
 * carries a bare fragment:
 *
 * - each rule's sentence is an anchor to `/forms/{formId}/rules#rule-{ruleId}`, which is
 *   the route AND the fragment, so it lands on the rule whether it is followed as a link,
 *   opened in a new tab, or reached with JavaScript off;
 * - "Edit rules" is the same route without a fragment;
 * - "Add rule" is that route plus `#new-rule`, which `RulesEditor` reads on arrival and
 *   opens its wizard on - the same shape the rail's own Add step already uses.
 *
 * The issue links in the validation panel below this card are the fourth of them and are
 * built from the same {@link ruleHref}.
 *
 * ## Why it repeats no count the validation panel owns
 *
 * `plan/admin-ux-audit.md` §5.6 objects to two independent counts of overlapping sets on
 * one screen. The digest here counts RULES, which the panel never counts; the per-rule
 * issue tag names issues belonging to one rule, which is a location rather than a rival
 * total. The screen still has exactly one issue count, and it is the panel's.
 */
export function RulesLens({
  draft,
  library,
  issues,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /** The engine's verdict, or an empty list when nothing has checked this draft yet. */
  readonly issues: readonly FormIssue[];
}) {
  const href = rulesHref(draft.formId);
  // A condition has to read a question, so a form with nothing pinned cannot take a rule.
  // The lens says so rather than offering a link to a screen that would refuse.
  const canAdd = draft.steps.some((step) => step.items.length > 0);

  return (
    <section
      aria-labelledby="qcms-rules-lens-heading"
      className="flex flex-col gap-3 rounded-md border border-(--color-border) bg-(--color-background-muted) p-4"
      data-testid="qcms-rules-lens"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="qcms-rules-lens-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.tab.rules")}
        </h2>
        {/* THE DIGEST, on the heading's row, the way the drawing puts it: a muted summary
            of the body's content that is present whether or not anyone reads the list.
            Rules only - see the note above on why this is not a second issue count. */}
        <span className="text-sm text-(--color-text-muted)" data-rule-count={draft.rules.length}>
          {tPlural("forms.rules.lensCountOne", "forms.rules.lensCount", draft.rules.length)}
        </span>
      </div>

      <p className="text-sm text-(--color-text-muted)">{t("forms.rules.lensNote")}</p>

      {draft.rules.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {draft.rules.map((rule) => (
            <li key={rule.ruleId}>
              <RuleLine
                href={ruleHref(draft.formId, rule.ruleId)}
                sentence={ruleSentence(rule, library, draft)}
                issueCount={issuesForRule(issues, rule.ruleId).length}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {/* Not prefetched, for the reason `RAIL_PREFETCH` records: this card sits on the
            screen an author is editing, so a prefetched rules payload is a snapshot of the
            draft taken before their next keystroke. */}
        <Link
          href={href}
          prefetch={RAIL_PREFETCH}
          className="qcms-text-link"
          data-testid="qcms-rules-lens-edit"
        >
          {t("forms.rules.editAll")}
        </Link>
        {/* AN ANCHOR, NOT A BUTTON, because off the rules screen this NAVIGATES: there is
            no rules editor in this tree to mint a rule in (`docs/admin-constraints.md` -
            an anchor navigates, a button acts). Absent rather than disabled when nothing
            is pinned: a disabled link is not a control any browser offers, and the
            sentence beside it says what to do first. */}
        {canAdd ? (
          <Link
            href={`${href}${NEW_RULE_HASH}`}
            prefetch={RAIL_PREFETCH}
            className="qcms-text-link"
            data-testid="qcms-rules-lens-add"
          >
            {t("forms.rules.add")}
          </Link>
        ) : (
          <span className="text-sm text-(--color-text-muted)">{t("forms.rules.needPin")}</span>
        )}
      </div>
    </section>
  );
}

/**
 * One rule, as the sentence it reads as, linked to itself on the rules screen.
 *
 * The sentence comes from `lib/forms/rule-sentence.ts` - the same module the rules table
 * uses - so the lens and the screen it points at cannot describe one rule two ways. What
 * is NOT shared is the row chrome: the table's row carries Edit and Remove, and this one
 * carries neither, which is the whole of what "read-only lens" means here.
 */
function RuleLine({
  href,
  sentence,
  issueCount,
}: {
  readonly href: string;
  readonly sentence: readonly RuleSentenceSegment[];
  readonly issueCount: number;
}) {
  return (
    <Link href={href} prefetch={RAIL_PREFETCH} className="qcms-text-link block">
      <span className="qcms-rule-sentence">
        {sentence.map((segment, index) => (
          <span
            // The index is the key because a sentence is a fixed sequence rendered whole:
            // segments are not reordered, inserted or removed, they are replaced together
            // when the rule changes.
            key={index}
            className={
              segment.kind === undefined ? undefined : `qcms-rule-sentence__${segment.kind}`
            }
          >
            {segment.text}
          </span>
        ))}
      </span>
      {/* Silence rather than a zero. An empty verdict and an absent one both arrive here as
          no issues, and this app does not let either claim a rule is clean - the same rule
          the rail's step badges follow. */}
      {issueCount > 0 && (
        <span className="qcms-tag qcms-tag--draft" data-rule-issues={issueCount}>
          {issueCountLabel(issueCount)}
        </span>
      )}
    </Link>
  );
}
