import { t, tPlural } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { groupAnchorId, stepAnchorId } from "./issues.ts";
import { isDraftGroup, type DraftGroup, type DraftStep } from "./types.ts";

// Validation stays with builder controls because its entries move focus there; rule destinations include their own route.
export const RAIL_SECTIONS = ["builder", "rules", "preview", "versions", "publish"] as const;

/** One of the form's sibling screens. */
export type RailSection = (typeof RAIL_SECTIONS)[number];

export type RailCurrent =
  | { readonly kind: "section"; readonly section: RailSection }
  | { readonly kind: "step"; readonly stepId: string }
  | { readonly kind: "group"; readonly groupId: string };

export interface RailItem {
  readonly key: string;

  readonly kind?: "step" | "group";

  readonly stepId?: string;

  readonly groupId?: string;
  readonly href: string;
  readonly label: string;

  readonly position?: number;

  readonly anchorId?: string;

  readonly issueCount: number;
  readonly isCurrent: boolean;
}

export interface RailGroups {
  readonly children: readonly RailItem[];
  readonly siblings: readonly RailItem[];
}

function sectionHref(base: string, section: RailSection): string {
  return section === "builder" ? base : `${base}/${section}`;
}

function stepLabel(step: DraftStep): string {
  const text = textOf(step.title);
  return text === "" ? t("forms.steps.untitled") : text;
}

function groupLabel(group: DraftGroup): string {
  const text = textOf(group.label);
  return text === "" ? t("forms.group.untitled") : text;
}

// Issue counts are API verdicts, never local domain validation.
export function formSubtreeRail({
  formId,
  slug,
  title,
  steps,
  issueCounts,
  current,
}: {
  readonly formId: string;

  readonly slug: string;

  readonly title: string;
  readonly steps: readonly DraftStep[];
  readonly issueCounts: ReadonlyMap<string, number>;
  readonly current: RailCurrent;
}): RailGroups {
  const base = `/forms/${encodeURIComponent(formId)}`;
  return {
    // List groups under their owning step so navigation preserves document order.
    children: steps.flatMap((step, index) => [
      {
        key: `step:${step.stepId}`,
        kind: "step" as const,
        stepId: step.stepId,
        href: `${base}#${stepAnchorId(step.stepId)}`,
        label: stepLabel(step),
        position: index + 1,
        anchorId: stepAnchorId(step.stepId),
        issueCount: issueCounts.get(step.stepId) ?? 0,
        isCurrent: current.kind === "step" && current.stepId === step.stepId,
      },
      ...step.items.filter(isDraftGroup).map((group) => ({
        key: `group:${group.groupId}`,
        kind: "group" as const,
        stepId: step.stepId,
        groupId: group.groupId,
        href: `${base}#${groupAnchorId(group.groupId)}`,
        label: groupLabel(group),
        anchorId: groupAnchorId(group.groupId),
        // Group issues already count against their step; a second group badge would double-count the form total.
        issueCount: 0,
        isCurrent: current.kind === "group" && current.groupId === group.groupId,
      })),
    ]),
    siblings: RAIL_SECTIONS.map((section) => ({
      key: `section:${section}`,
      href: sectionHref(base, section),

      label: section === "builder" ? formDisplayName(title, slug) : t(`forms.tab.${section}`),
      issueCount: 0,
      isCurrent: current.kind === "section" && current.section === section,
    })),
  };
}

// The collapsed count belongs to the whole form, not the active item beside its name.

export function formDisplayName(title: string, slug: string): string {
  const named = title.trim();
  return named === "" ? slug : named;
}

export function railIssueTotal(groups: RailGroups): number {
  return groups.children.reduce((total, item) => total + item.issueCount, 0);
}

export function railStepItems(groups: RailGroups): readonly RailItem[] {
  return groups.children.filter((item) => item.kind !== "group");
}

export function issueCountLabel(count: number): string {
  return tPlural("forms.steps.issuesOne", "forms.steps.issues", count);
}
