import Link from "next/link";
import type { ReactNode } from "react";

import { RailFrame } from "@/components/rail-frame";
import {
  formDisplayName,
  formSubtreeRail,
  issueCountLabel,
  railIssueTotal,
  type RailCurrent,
  type RailItem,
} from "@/lib/forms/subtree-rail";
import type { DraftStep } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The form subtree's parts of the one rail (`plan/admin-design-contracts.md` §7.0 and §7.1,
 * issues 559 and #1116).
 *
 * What goes in each group and where each row points is decided in
 * `lib/forms/subtree-rail.ts`; this file is the markup for that answer, handed to
 * `components/rail-frame.tsx` as the five parts the one anatomy has.
 *
 * - **Header:** back to Forms, the form's display name, and the form's open/closed status.
 *   The name is no longer said twice: the frame used to hide this rail's summary above
 *   `--bp-sidebar` because the Form row carried the name too, and §7.0's Header carries a
 *   back link and a tag that no row has, so it stays at every width (issue #1116).
 * - **Sections:** the form's sibling routes, with its steps nested inside the Form row.
 * - **Actions:** Add step, which is the one structural action this subtree has. It used to
 *   sit inside the step cluster, under the list; §7.0 puts a structural action in the
 *   Actions part, and `components/forms/rail-add-step.tsx` is what moved there.
 *
 * ## What it does not carry, and why each absence is load-bearing
 *
 * - **The steps are nested in the Form row**, not stacked above the sibling routes, which is
 *   what `plan/admin-shell-poc/admin-shell-poc.html` draws and what the data model says: a
 *   form's steps belong to the form's own screen rather than being a seventh peer of its
 *   sibling routes (Code Owner, 2026-08-25).
 * - **No Validation route.** `plan/admin-ux-audit.md` §5.5: the builder's validation
 *   entries are links that move focus to the offending control, so splitting them onto a
 *   route of their own resolves every one of them to nothing, and takes the publish
 *   rejection list with them. `rules-screen-poc.html` draws it as a rail route; it is
 *   wrong.
 * - **No lifecycle action.** Publish and Close belong to the form's own heading row, which
 *   is where the builder already renders them (§7.0 ruling 5).
 *
 * A server component, and it needs to be nothing else: which item is current is a fact
 * about the route that renders it, so it arrives as a prop instead of being read from the
 * pathname in the browser. Nothing here ships to the client or waits for hydration, so the
 * rail is complete and operable in the first paint.
 */
export function FormSubtreeRail({
  formId,
  slug,
  title,
  status,
  steps,
  issueCounts,
  current,
  renderSteps,
  actions,
}: {
  readonly formId: string;
  /** The form's own name, and the Header's fallback. */
  readonly slug: string;
  /** The form's own title, or `""`. The rail shows it in place of the slug. */
  readonly title: string;
  /** The form's open/closed status, which the Header states as its one tag. */
  readonly status: "open" | "closed";
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
   * other screen passes nothing and gets the anchors. Same seam the Actions part uses, and
   * for the same reason.
   */
  readonly renderSteps?: (item: RailItem, steps: readonly RailItem[]) => ReactNode;
  /** The Actions part: Add step, which only a client component can render on the builder. */
  readonly actions?: ReactNode;
}) {
  const groups = formSubtreeRail({ formId, slug, title, steps, issueCounts, current });
  const issues = railIssueTotal(groups);
  const name = formDisplayName(title, slug);

  return (
    <RailFrame
      subject={name}
      back={{ href: "/forms", label: t("forms.title") }}
      title={name}
      tag={
        <span className={`qcms-tag qcms-tag--form-${status}`} data-status={status}>
          {t(`forms.status.${status}`)}
        </span>
      }
      // THE COLLAPSED HEADER'S ONE COUNT (§7.0, clarified 2026-10-24): the form's issue
      // total, not the selected row's. The summary used to carry whichever row was current
      // and that row's count, so at 390 the one line of the rail said a different thing on
      // each of the eight screens; the subject and its total say the same thing on all of
      // them. Spread rather than passed as `undefined`: `exactOptionalPropertyTypes` treats
      // an explicit undefined and an absent property as different things, and the absent
      // one is what "this form has no issues" means.
      {...(issues > 0 ? { count: issueCountLabel(issues) } : {})}
      {...(actions === undefined ? {} : { actions })}
      sections={
        /* One list, with the steps nested inside the Form row rather than stacked above
           the whole thing (Code Owner, 2026-08-25, and `plan/admin-shell-poc/
           admin-shell-poc.html`, which draws exactly this). A form's steps belong TO the
           form's own screen, so a flat group above six sibling routes said they were a
           seventh peer of them; nested, the tree says what the data model says. */
        <RailGroup
          label={t("forms.rail.sections")}
          items={groups.siblings}
          kind="sections"
          steps={groups.children}
          stepsUnder="section:builder"
          {...(renderSteps === undefined ? {} : { renderSteps })}
        />
      }
    />
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
