import Link from "next/link";
import type { ReactNode } from "react";

import { RailDisclosure } from "@/components/rail-disclosure";
import { HideSidebarButton, ShowSidebarButton } from "@/components/sidebar-toggle";
import { t } from "@/lib/i18n/en";
import { RAIL_REGION_ID } from "@/lib/sidebar";

/* The rail may contain structural actions only; lifecycle and destructive actions belong in the content
   heading row. */
export function RailFrame({
  subject,
  back,
  title,
  tag,
  count,
  lines,
  sections,
  children,
  filters,
  actions,
  filterCount = 0,
  testId = "qcms-rail",
}: {
  readonly subject: string;
  readonly back?: { readonly href: string; readonly label: string };
  readonly title: ReactNode;
  readonly tag?: ReactNode;
  readonly count?: ReactNode;
  readonly lines?: ReactNode;
  readonly sections?: ReactNode;
  readonly children?: ReactNode;
  readonly filters?: ReactNode;
  readonly actions?: ReactNode;
  readonly filterCount?: number;
  readonly testId?: string;
}) {
  return (
    <>
      <ShowSidebarButton filterCount={filterCount} />
      <aside id={RAIL_REGION_ID} className="qcms-rail" aria-label={subject} data-testid={testId}>
        {back !== undefined && (
          <Link href={back.href} className="qcms-rail__back">
            <span aria-hidden="true">{"‹"}</span>
            {back.label}
          </Link>
        )}
        <HideSidebarButton />
        <RailDisclosure>
          <summary className="qcms-rail__summary">
            <span className="qcms-rail__summary-text">{title}</span>
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
