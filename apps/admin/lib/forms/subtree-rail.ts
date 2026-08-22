import { t, tPlural } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { stepAnchorId } from "./issues.ts";
import type { DraftStep } from "./types.ts";

/**
 * What the form-subtree rail carries, as data (`plan/admin-design-contracts.md` §7,
 * issue 559).
 *
 * The whole contract is two groups in one order with one divider: the form's **children**
 * (its steps, with per-step issue badges) and the form's **siblings** (Builder, Preview,
 * Versions, Links, Responses, Webhooks). It never carries an action, never carries a
 * same-page section switch, and never carries a route the audit rejected - Validation
 * stays on the builder page (`plan/admin-ux-audit.md` §5.5), so it is absent from
 * {@link RAIL_SECTIONS} and adding it here would break the anchored issue links the
 * validation panel and the publish rejection list are both built out of.
 *
 * WHY THE ANSWER IS A PURE FUNCTION AND NOT MARKUP. Three of the four things the
 * acceptance asks about - both groups in the right order, the badge on the right step,
 * the right item marked current - are decisions rather than pixels, and a decision tested
 * through a DOM is tested through two things at once. The component below it renders what
 * this returns and takes no view of its own about what belongs in a rail.
 *
 * ## Where a step link goes, and why that is an application rather than an invention
 *
 * §7 says the children are the form's steps and that rail items are anchors. In this app a
 * step is not a route: it is a selection inside the builder, and the audit records
 * step-per-route as the thing that produced the POC's scope bug (§3.5), so minting one
 * here would be deciding a question the contract did not delegate. What a step already
 * HAS is a stable DOM id on the builder - {@link stepAnchorId}, minted so an issue can be
 * a link that moves focus to the step it names - and the validation panel already ships
 * links of exactly that shape. So a step's rail item is the builder's URL with that
 * fragment: a real anchor, no JavaScript, opens in a new tab, and lands on the step it
 * names. No new route, no new scope, no new pattern.
 */

/** The six sibling routes, in the order §7 lists them. Validation is deliberately absent. */
export const RAIL_SECTIONS = [
  "builder",
  "preview",
  "versions",
  "links",
  "responses",
  "webhooks",
] as const;

/** One of the form's sibling screens. */
export type RailSection = (typeof RAIL_SECTIONS)[number];

/** Which item of the rail the screen showing it is. */
export type RailCurrent =
  | { readonly kind: "section"; readonly section: RailSection }
  | { readonly kind: "step"; readonly stepId: string };

/** One rendered row of the rail. Every row is a link, because §7 has no other kind. */
export interface RailItem {
  /** React key and test hook. Unique across both groups. */
  readonly key: string;
  readonly href: string;
  readonly label: string;
  /** A step's ordinal, or `undefined` for a sibling screen, which has no order to show. */
  readonly position?: number;
  /** Rendered as a count tag when it is above zero, and only then. */
  readonly issueCount: number;
  readonly isCurrent: boolean;
}

/** The two groups, in the order the divider separates them. */
export interface RailGroups {
  readonly children: readonly RailItem[];
  readonly siblings: readonly RailItem[];
}

/** What the collapsed disclosure's summary says: the active item, and its count if it has one. */
export interface RailSummary {
  readonly text: string;
  readonly issueCount: number;
}

/** The path each sibling screen lives at, relative to the form. The builder IS the form. */
function sectionHref(base: string, section: RailSection): string {
  return section === "builder" ? base : `${base}/${section}`;
}

/**
 * A step's display name, matching what the builder's own step list shows for an unnamed
 * step: a form under construction passes through titles that do not exist yet, and a row
 * with no text at all could not be clicked with confidence or read aloud.
 */
function stepLabel(step: DraftStep): string {
  const text = textOf(step.title);
  return text === "" ? t("forms.steps.untitled") : text;
}

/**
 * Both groups of the rail for one form.
 *
 * `issueCounts` is passed in rather than derived, and that is the same division of labour
 * `stepIssueCounts` already has: whether a draft is legal is the API's answer and never
 * this app's (R2). A caller that has no verdict passes an empty map and the rail renders
 * without badges rather than claiming a form is clean.
 */
export function formSubtreeRail({
  formId,
  steps,
  issueCounts,
  current,
}: {
  readonly formId: string;
  readonly steps: readonly DraftStep[];
  readonly issueCounts: ReadonlyMap<string, number>;
  readonly current: RailCurrent;
}): RailGroups {
  const base = `/forms/${encodeURIComponent(formId)}`;
  return {
    children: steps.map((step, index) => ({
      key: `step:${step.stepId}`,
      href: `${base}#${stepAnchorId(step.stepId)}`,
      label: stepLabel(step),
      position: index + 1,
      issueCount: issueCounts.get(step.stepId) ?? 0,
      isCurrent: current.kind === "step" && current.stepId === step.stepId,
    })),
    siblings: RAIL_SECTIONS.map((section) => ({
      key: `section:${section}`,
      href: sectionHref(base, section),
      label: t(`forms.tab.${section}`),
      issueCount: 0,
      isCurrent: current.kind === "section" && current.section === section,
    })),
  };
}

/**
 * The summary line for the collapsed rail: the active item's name, and its issue count
 * when it has one.
 *
 * The slug is the fallback and not a preference. Every screen that renders a rail is one
 * of the items in it, so the fallback is unreachable in practice; a summary is still the
 * one line an operator sees while the rail is shut, and leaving it empty because a caller
 * passed a `current` that matched nothing would be the worst of the available failures.
 */
export function railSummary(groups: RailGroups, slug: string): RailSummary {
  const active = [...groups.children, ...groups.siblings].find((item) => item.isCurrent);
  if (active === undefined) return { text: slug, issueCount: 0 };
  return { text: active.label, issueCount: active.issueCount };
}

/** One item's issue count, written the way the builder's step list writes the same number. */
export function issueCountLabel(count: number): string {
  return tPlural("forms.steps.issuesOne", "forms.steps.issues", count);
}
