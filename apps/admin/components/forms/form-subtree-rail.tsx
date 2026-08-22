import Link from "next/link";

import { RailFrame } from "@/components/rail-frame";
import {
  formSubtreeRail,
  issueCountLabel,
  railSummary,
  type RailCurrent,
  type RailItem,
} from "@/lib/forms/subtree-rail";
import type { DraftStep } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The form-subtree rail (`plan/admin-design-contracts.md` §7, issue 559).
 *
 * Navigation within one form's subtree, and nothing else: the form's children (its steps,
 * with per-step issue badges), a divider, then the form's siblings (Builder, Preview,
 * Versions, Links, Responses, Webhooks). What goes in each group and where each row points
 * is decided in `lib/forms/subtree-rail.ts`; this file is the markup for that answer.
 *
 * ## What it does not carry, and why each absence is load-bearing
 *
 * - **No actions.** There is not a `<button>` in this file, and the test beside it asserts
 *   that by counting them rather than by reading it. Add, rename, reorder and remove are
 *   the builder's, on the builder's own step list, where the draft they mutate lives; a
 *   lifecycle button belongs in the main column. The POCs draw a grip and an overflow menu
 *   on every rail step row (`plan/admin-shell-poc/admin-shell-poc.html`); §7 says the rail
 *   never carries an action, and where a POC and the contract disagree the contract wins.
 * - **No same-page section switches.** That is the whole line between this component and
 *   the Settings rail of §7a, which is a different component that happens to share the
 *   column. Every row here is a route.
 * - **No Validation route.** `plan/admin-ux-audit.md` §5.5: the builder's validation
 *   entries are links that move focus to the offending control, so splitting them onto a
 *   route of their own resolves every one of them to nothing, and takes the publish
 *   rejection list with them. `rules-screen-poc.html` draws it as a rail route; it is
 *   wrong.
 *
 * ## Distinctly named, on purpose
 *
 * §7a's condition on keeping a Settings rail was that it be "a distinct component from the
 * form-subtree rail, named distinctly in the code, so no future reader can mistake one for
 * the other or 'unify' them". `FormSubtreeRail` is that name on this side. The shared
 * quarter of the two - the column, the width, the collapse, anchors-not-buttons - is
 * `components/rail-frame.tsx` and `app/globals.css`, neither of which knows what a rail
 * carries.
 *
 * A server component, and it needs to be nothing else: which item is current is a fact
 * about the route that renders it, so it arrives as a prop instead of being read from the
 * pathname in the browser. Nothing here ships to the client or waits for hydration, and
 * the rail is entirely operable with JavaScript disabled.
 */
export function FormSubtreeRail({
  formId,
  slug,
  steps,
  issueCounts,
  current,
}: {
  readonly formId: string;
  /** The form's own name, and the summary's fallback. */
  readonly slug: string;
  readonly steps: readonly DraftStep[];
  /** Per-step issue counts from the API's verdict, or empty when there is none (R2). */
  readonly issueCounts: ReadonlyMap<string, number>;
  /** Which row this screen is. */
  readonly current: RailCurrent;
}) {
  const groups = formSubtreeRail({ formId, steps, issueCounts, current });
  const summary = railSummary(groups, slug);

  return (
    <RailFrame
      label={t("forms.rail.label", { slug })}
      summaryText={summary.text}
      // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes` treats an
      // explicit undefined and an absent property as different things, and the absent one
      // is what "this item has no count" means.
      {...(summary.issueCount > 0 ? { summaryCount: issueCountLabel(summary.issueCount) } : {})}
    >
      {/* A form with no steps yet has no children, so it gets neither the group nor the
          divider: §7's "one divider" separates two groups, and there is nothing to
          separate a group from. The siblings are always there, because a form always has
          six sections whether or not anyone has built it yet. */}
      {groups.children.length > 0 && (
        <>
          <RailGroup label={t("forms.rail.steps")} items={groups.children} kind="steps" />
          <hr className="qcms-rail__divider" />
        </>
      )}
      <RailGroup label={t("forms.rail.sections")} items={groups.siblings} kind="sections" />
    </RailFrame>
  );
}

/**
 * One group of rows.
 *
 * The group is named with `aria-label` on the list rather than with a heading, and that is
 * a deliberate choice about heading order, not an oversight. This rail renders before
 * `<main>` on every screen it appears on, so any heading in it would sit above that
 * screen's `<h1>` in document order and be a `heading-order` violation on all eight
 * screens at once (`e2e/a11y-axe.pw.ts` runs axe over three modes per state and would say
 * so). A list's accessible name is announced on entry, which is where a group label is
 * useful anyway.
 *
 * The steps are an `<ol>` and the sections a `<ul>`, because a form's steps have an order
 * that is part of what they mean (ADR-16 reads document order) and its sections do not.
 * That is also what lets the visible ordinal stay `aria-hidden`: the list element already
 * tells a screen reader "item 2 of 4", so reading "2." on top of that would say it twice.
 */
function RailGroup({
  label,
  items,
  kind,
}: {
  readonly label: string;
  readonly items: readonly RailItem[];
  readonly kind: "steps" | "sections";
}) {
  const List = kind === "steps" ? "ol" : "ul";
  return (
    <List className="qcms-rail__group" aria-label={label} data-rail-group={kind}>
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className="qcms-rail__link"
            data-rail-item={item.key}
            {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
          >
            {item.position !== undefined && (
              <span className="qcms-rail__position" aria-hidden="true">
                {t("forms.rail.stepPosition", { position: item.position })}
              </span>
            )}
            <span>{item.label}</span>
            {item.issueCount > 0 && (
              <span className="qcms-tag qcms-tag--draft" data-rail-issues={item.issueCount}>
                {issueCountLabel(item.issueCount)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </List>
  );
}
