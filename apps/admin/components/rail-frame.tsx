import type { ReactNode } from "react";
import { RailDisclosure } from "@/components/rail-disclosure";

/**
 * The rail's chrome, and only its chrome (`plan/admin-design-contracts.md` §7 and §7a,
 * issue 559).
 *
 * ## This is not "the rail". Read §7a before adding anything to it
 *
 * The app is going to ship two rails that look identical and behave differently. The
 * form-subtree rail (§7) carries navigation between ROUTES and explicitly never carries a
 * same-page section switch; the Settings rail (§7a) can only carry same-page section
 * switches, because Settings is one route. §7a settles that by making them two components
 * and listing exactly what they share: "the grid column, the 240px width, the
 * `--bp-sidebar` collapse behaviour and the anchors-not-buttons rule - and nothing else".
 *
 * This file is those shared four and nothing else. It takes a summary line and some
 * children, and it has no opinion whatever about what a rail carries - no items, no
 * groups, no divider, no counts of its own. That is what stops it from becoming the seam
 * along which the two contracts get "unified": there is nothing in here to unify, and the
 * two components that use it stay separately named and separately reviewable.
 * `components/forms/form-subtree-rail.tsx` is §7's.
 *
 * ## Why a native `<details>`, and where its open state is decided
 *
 * Below `--bp-sidebar` the contract asks for a disclosure; at and above it, for a 240px
 * column. An element cannot be chosen by media query, so the choice is between one
 * `<details>` at both widths and two copies of the same navigation in the DOM with one
 * hidden - and a second copy of a navigation is a second set of links for a screen reader
 * to walk, which is exactly what "the markup is one shared component" exists to prevent.
 *
 * A native `<details>` also settles the accessibility of the collapsed state without a line
 * of script: the summary is keyboard-operable by construction and the browser announces
 * expanded and collapsed itself, which no `aria-expanded` we wrote by hand would do more
 * reliably. Above the boundary the chevron goes and the summary stops advertising itself as
 * a control (`app/globals.css`); it remains one, so an operator who wants the width back can
 * take it.
 *
 * **It is shut by default below the boundary and open above it** (Code Owner decision,
 * 2026-08-23), which is the one thing about the element that cannot be decided here:
 * `open` is an attribute and no media query sets one. `components/rail-disclosure.tsx` owns
 * that and writes out why it is a client component and what is true before it runs.
 *
 */
export function RailFrame({
  label,
  summaryText,
  summaryCount,
  children,
}: {
  /** The navigation landmark's accessible name. */
  readonly label: string;
  /** The active item's name. Truncates with an ellipsis; it is the only line that does. */
  readonly summaryText: string;
  /** The active item's issue count, already written out, or `undefined` when it has none. */
  readonly summaryCount?: string;
  readonly children: ReactNode;
}) {
  return (
    <nav className="qcms-rail" aria-label={label} data-testid="qcms-rail">
      <RailDisclosure>
        <summary className="qcms-rail__summary">
          <span className="qcms-rail__summary-text">{summaryText}</span>
          {summaryCount !== undefined && (
            <span className="qcms-tag qcms-tag--draft" data-testid="qcms-rail-summary-count">
              {summaryCount}
            </span>
          )}
          {/* Decorative: the disclosure's state is already announced by the element
              itself, so a second statement of it here would only be said twice. */}
          <span className="qcms-rail__chevron" aria-hidden="true">
            {"›"}
          </span>
        </summary>
        <div className="qcms-rail__body">{children}</div>
      </RailDisclosure>
    </nav>
  );
}
