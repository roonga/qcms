"use client";

import { Breadcrumb, type BreadcrumbItem } from "@/components/kit";
import { useBuilderRail, type BuilderSelection } from "@/lib/forms/builder-bridge";
import type { DraftStep } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

/**
 * The builder's breadcrumb, whose last crumb is the SCREEN the reader is on.
 *
 * The builder is three screens behind one route, and the breadcrumb is rendered once per
 * route - so it said "Form details" while the reader was looking at a step's questions or
 * at the form's rules. A trail that names somewhere you are not is worse than no trail: it
 * is the one part of the chrome whose whole job is to say where you are.
 *
 * A client component for that reason, and it reads the same bridge the rail does rather
 * than taking the selection as a prop, because the page that renders it is a server
 * component and cannot know a selection made in the browser.
 *
 * ## What it says before the builder publishes
 *
 * "Form details", which is the screen the builder opens on, so the crumb is right from the
 * first paint rather than correcting itself a frame later. A reader with no JavaScript sees
 * the same thing, and for them it is simply true: without the bridge nothing can change the
 * screen, so the form's details are all there is.
 */
export function BuilderBreadcrumb({
  formId,
  slug,
}: {
  readonly formId: string;
  readonly slug: string;
}) {
  const builder = useBuilderRail();
  const items: BreadcrumbItem[] = [
    { id: "forms", label: t("forms.builder.crumbs"), href: "/forms" },
    { id: formId, label: slug, href: `/forms/${encodeURIComponent(formId)}` },
    { id: "screen", label: currentScreenName(builder?.selection, builder?.draft.steps ?? []) },
  ];
  return <Breadcrumb items={items} ariaLabel={t("forms.builder.crumbLabel")} />;
}

/**
 * What to call the screen the builder is showing.
 *
 * Exported and pure so the heading can say the same thing the crumb does, from the same
 * lookup. They were two, which is how a screen ends up answering to two names - the crumb
 * read "Form details" while the reader was looking at a step.
 *
 * `undefined` is the pre-hydration and no-JavaScript answer, and it is not a fallback: the
 * builder opens on the form's details, and without the bridge nothing can change that, so
 * "Form details" is simply true.
 */
export function currentScreenName(
  selection: BuilderSelection | undefined,
  steps: readonly DraftStep[],
): string {
  if (selection === undefined || selection.kind === "form") return t("forms.tab.builder");
  if (selection.kind === "rules") return t("forms.rail.rules");
  const step = steps.find((candidate) => candidate.stepId === selection.stepId);
  if (step === undefined) return t("forms.tab.builder");
  const title = textOf(step.title);
  return title === "" ? t("forms.steps.untitled") : title;
}
