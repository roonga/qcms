import Link from "next/link";
import type { ReactNode } from "react";

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
 * - **The steps are nested in the Form row**, not stacked above the six sections, which is
 *   what `plan/admin-shell-poc/admin-shell-poc.html` draws and what the data model says: a
 *   form's steps belong to the form's own screen rather than being a seventh peer of its
 *   sibling routes (Code Owner, 2026-08-25).
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
  title,
  steps,
  issueCounts,
  current,
  renderSteps,
}: {
  readonly formId: string;
  /** The form's own name, and the summary's fallback. */
  readonly slug: string;
  /** The form's own title, or `""`. The rail shows it in place of the slug. */
  readonly title: string;
  readonly steps: readonly DraftStep[];
  /** Per-step issue counts from the API's verdict, or empty when there is none (R2). */
  readonly issueCounts: ReadonlyMap<string, number>;
  /** Which row this screen is. */
  readonly current: RailCurrent;
  /**
   * How to render the nested steps, when the screen wants more than anchors.
   *
   * A render prop rather than an import, so this file stays a server component that knows
   * nothing about client state: the builder's slot hands in the interactive list and every
   * other screen passes nothing and gets the anchors. Same seam
   * `components/questions/question-versions-rail.tsx` uses for its lifecycle actions, and
   * for the same reason.
   */
  readonly renderSteps?: (item: RailItem, steps: readonly RailItem[]) => ReactNode;
}) {
  const groups = formSubtreeRail({ formId, slug, title, steps, issueCounts, current });
  const summary = railSummary(groups, slug, title);

  return (
    <RailFrame
      modifier="form"
      label={t("forms.rail.label", { slug })}
      summaryText={summary.text}
      // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes` treats an
      // explicit undefined and an absent property as different things, and the absent one
      // is what "this item has no count" means.
      {...(summary.issueCount > 0 ? { summaryCount: issueCountLabel(summary.issueCount) } : {})}
    >
      {/* One list, with the steps nested inside the Form row rather than stacked above
          the whole thing (Code Owner, 2026-08-25, and `plan/admin-shell-poc/
          admin-shell-poc.html`, which draws exactly this). A form's steps belong TO the
          form's own screen, so a flat group above six sibling routes said they were a
          seventh peer of them; nested, the tree says what the data model says.

          The divider went with the flattening. §7's "one divider between two groups"
          described two groups, and there is one list now. */}
      <RailGroup
        label={t("forms.rail.sections")}
        items={groups.siblings}
        kind="sections"
        steps={groups.children}
        stepsUnder="section:builder"
        {...(renderSteps === undefined ? {} : { renderSteps })}
      />
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
  steps,
  stepsUnder,
  renderSteps,
}: {
  readonly label: string;
  readonly items: readonly RailItem[];
  readonly kind: "steps" | "sections";
  /** The form's steps, rendered nested inside the row named by {@link stepsUnder}. */
  readonly steps?: readonly RailItem[];
  readonly stepsUnder?: string;
  /**
   * Replaces the row named by {@link stepsUnder} AND the steps under it, rather than
   * adding to them. The builder needs that: on that one screen the row is a control
   * rather than a link, so the interactive version owns the whole subtree or the screen
   * ends up with two rows meaning one thing.
   */
  readonly renderSteps?: (item: RailItem, steps: readonly RailItem[]) => ReactNode;
}) {
  const List = kind === "steps" ? "ol" : "ul";
  return (
    <List className="qcms-rail__group" aria-label={label} data-rail-group={kind}>
      {items.map((item) => (
        <li key={item.key}>
          {item.key === stepsUnder && steps !== undefined && renderSteps !== undefined ? (
            renderSteps(item, steps)
          ) : (
            <>
              <RailRow item={item} />
              {item.key === stepsUnder && steps !== undefined && steps.length > 0 && (
                // A form with no steps yet nests nothing: an empty `<ol>` announced as a
                // list of zero would be a promise the form has not made.
                <RailGroup label={t("forms.rail.steps")} items={steps} kind="steps" />
              )}
            </>
          )}
        </li>
      ))}
    </List>
  );
}

/** One row, shared by both levels of the tree so a nested step wears the same chrome. */
function RailRow({ item }: { readonly item: RailItem }) {
  return (
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
  );
}
