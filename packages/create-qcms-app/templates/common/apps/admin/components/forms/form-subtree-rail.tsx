import Link from "next/link";
import type { ReactNode } from "react";

import { RailCount, RailFrame } from "@/components/rail-frame";
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
  readonly slug: string;
  readonly title: string;
  readonly status: "open" | "closed";
  readonly steps: readonly DraftStep[];
  readonly issueCounts: ReadonlyMap<string, number>;
  readonly current: RailCurrent;
  readonly renderSteps?: (item: RailItem, steps: readonly RailItem[]) => ReactNode;
  readonly actions?: ReactNode;
}) {
  const groups = formSubtreeRail({ formId, slug, title, steps, issueCounts, current });
  const issues = railIssueTotal(groups);
  const name = formDisplayName(title, slug);

  return (
    <RailFrame
      subject={name}
      context={{ href: "/forms", label: t("rail.allForms") }}
      label={name}
      crumbs={{ form: name }}
      tag={
        <span className={`qcms-tag qcms-tag--form-${status}`} data-status={status}>
          {t(`forms.status.${status}`)}
        </span>
      }
      {...(issues > 0 ? { count: <RailCount>{issueCountLabel(issues)}</RailCount> } : {})}
      {...(actions === undefined ? {} : { actions })}
      sections={
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

/* Steps use an ordered list because document order is semantic; sibling sections have no ordinal. */
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
  readonly steps?: readonly RailItem[];
  readonly stepsUnder?: string;
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
                <RailGroup label={t("forms.rail.steps")} items={steps} kind="steps" />
              )}
            </>
          )}
        </li>
      ))}
    </List>
  );
}

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
