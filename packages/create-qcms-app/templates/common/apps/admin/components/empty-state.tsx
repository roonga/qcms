import type { ReactNode } from "react";

/**
 * The app's one empty state (issue 514; `plan/admin-design-contracts.md` §3).
 *
 * Two shapes shipped before this and neither was the frozen card's: a bordered
 * `Card` with an `h2` and prose on the two library screens, and a bare muted
 * paragraph on seven others (`plan/admin-ux-audit.md` §4.2). §3 settles it on the
 * card's shape - a centred dashed panel on the surface colour, a heading, one
 * sentence, and a primary action where the screen has a creating one - and retires
 * the bare paragraph. This component is that shape, so no screen owns a copy of it.
 *
 * ## The three things a caller must get right
 *
 * **The heading is an `h2`.** §3 names the level, and it is a real heading rather
 * than a bold paragraph because it is the only thing naming the region when the list
 * it replaces is gone: a screen reader user arriving by heading navigation finds
 * "No responses yet" where the table's caption used to be. The frozen card draws it
 * as a `<p style="font-weight: 600">`; the contract does not, and the contract wins.
 *
 * **One sentence, or none.** `body` is optional exactly so the filtered variant can
 * leave it out: §3 keeps the panel and the CTA for a filtered-empty list, swaps the
 * heading to "no matches", and drops the explanatory sentence, because a sentence
 * explaining what the screen is for is answering a question the operator did not ask
 * when they have just typed a filter.
 *
 * **This is not an error state.** A failed read renders its alert and NOTHING else
 * (§3, issue #513's rule): no empty list, no panel, no "there are none" claim about
 * data the app never managed to read. Rendering this component beside an error alert
 * is a defect, not a fallback, and `app/(shell)/responses/erasures/page.tsx` did
 * exactly that until this issue.
 */
export function EmptyState({
  heading,
  body,
  action,
  testId,
}: {
  readonly heading: string;
  readonly body?: string | undefined;
  /** The primary CTA, where the screen has a creating action to offer (§3). */
  readonly action?: ReactNode;
  readonly testId?: string | undefined;
}) {
  return (
    <div className="qcms-empty" {...(testId === undefined ? {} : { "data-testid": testId })}>
      <h2 className="qcms-empty__heading">{heading}</h2>
      {body !== undefined && <p className="qcms-empty__body">{body}</p>}
      {action !== undefined && <div className="qcms-empty__action">{action}</div>}
    </div>
  );
}
