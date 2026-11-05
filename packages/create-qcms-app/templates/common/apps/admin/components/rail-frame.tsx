import Link from "next/link";
import type { ReactNode } from "react";

import { RailDisclosure } from "@/components/rail-disclosure";
import { ShellBreadcrumb } from "@/components/shell/shell-breadcrumb";
import { t } from "@/lib/i18n/en";
import type { CrumbNames } from "@/lib/shell/breadcrumbs";
import { RAIL_REGION_ID } from "@/lib/sidebar";

/* The rail may contain structural actions only; lifecycle and destructive actions belong in the content
   heading row. */
export function RailFrame({
  subject,
  context,
  label,
  tag,
  count,
  lines,
  sections,
  children,
  filters,
  actions,
  crumbs,
  testId = "qcms-rail",
}: {
  /** The rail landmark's accessible name. */
  readonly subject: string;
  /** Inside one item only: the way to the area's list of items. */
  readonly context?: { readonly href: string; readonly label: string };
  /** Inside one item only: the item's name. An area rail has none, so it never repeats the page title. */
  readonly label?: ReactNode;
  readonly tag?: ReactNode;
  readonly count?: ReactNode;
  readonly lines?: ReactNode;
  readonly sections?: ReactNode;
  readonly children?: ReactNode;
  readonly filters?: ReactNode;
  readonly actions?: ReactNode;
  readonly crumbs?: CrumbNames;
  readonly testId?: string;
}) {
  return (
    <>
      <aside id={RAIL_REGION_ID} className="qcms-rail" aria-label={subject} data-testid={testId}>
        {context !== undefined && (
          <Link href={context.href} className="qcms-rail__back" data-testid="qcms-rail-context">
            <span aria-hidden="true">{"‹"}</span>
            {context.label}
          </Link>
        )}
        <RailDisclosure>
          <summary
            className={
              label === undefined
                ? "qcms-rail__summary qcms-rail__summary--area"
                : "qcms-rail__summary"
            }
          >
            <span className="qcms-rail__summary-text" data-testid="qcms-rail-label">
              {label ?? t("rail.menu")}
            </span>
            {tag}
            {count}
            <span className="qcms-rail__chevron" aria-hidden="true">
              {"›"}
            </span>
          </summary>
          <div className="qcms-rail__body">
            {lines}
            {sections !== undefined && (
              // Name the navigation for its subject so screen-reader landmarks distinguish it from the shell navigation.
              <nav aria-label={t("rail.sections", { subject })}>{sections}</nav>
            )}
            {children}
            {filters}
            {actions !== undefined && <div className="qcms-rail__actions">{actions}</div>}
          </div>
        </RailDisclosure>
      </aside>
      <ShellBreadcrumb {...(crumbs === undefined ? {} : { names: crumbs })} />
    </>
  );
}

export function RailCount({ children }: { readonly children: ReactNode }) {
  return (
    <span className="qcms-tag qcms-tag--draft" data-testid="qcms-rail-summary-count">
      {children}
    </span>
  );
}

export interface RailTreeItem {
  /** The `data-rail-item` value the specs and the agent read. */
  readonly key: string;
  readonly href: string;
  readonly label: ReactNode;
  readonly current?: boolean;
  /** Present on an item that can expand; drawn beneath it only while it does. */
  readonly children?: ReactNode;
  readonly expanded?: boolean;
}

/** An area rail's tree: its top-level items always shown and the current one's sub-items beneath it. */
export function RailTree({ items }: { readonly items: readonly RailTreeItem[] }) {
  return (
    <ul className="qcms-rail__group" data-rail-group="sections">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className="qcms-rail__link"
            data-rail-item={item.key}
            {...(item.current === true ? { "aria-current": "page" as const } : {})}
            {...(item.children === undefined ? {} : { "aria-expanded": item.expanded === true })}
          >
            {item.label}
          </Link>
          {item.expanded === true && item.children}
        </li>
      ))}
    </ul>
  );
}
