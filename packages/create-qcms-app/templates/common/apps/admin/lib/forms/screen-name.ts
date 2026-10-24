import type { BuilderSelection } from "@/lib/forms/builder-bridge";
import type { DraftStep } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

/**
 * What to call the screen the builder is showing (issue #1116; before that it lived in
 * `components/forms/builder-breadcrumb.tsx`).
 *
 * ## Why it outlived the component it was written for
 *
 * It was the last crumb of the builder's breadcrumb: the builder is two screens behind one
 * route, so a trail rendered once per route said "Form details" while the reader was looking
 * at a step's questions, and a trail that names somewhere you are not is worse than no trail.
 * §7.0 ruling 3 retired the breadcrumb on every form screen in favour of the rail Header's
 * back link, so the component went - and the builder's own `<h1>` still needs this answer.
 *
 * **From one place, which is the whole reason it is exported.** The heading and the rail's
 * marked row both resolve the screen's name through this function; two lookups is how a screen
 * ends up answering to two names, which is what it did before - the rail read "Form details"
 * while the crumb read "Builder".
 *
 * `undefined` is the answer for the frame before React attaches, and it is not a fallback: the
 * builder opens on the form's details, and without the bridge nothing can change that, so
 * "Form details" is simply true.
 *
 * Pure, and in `lib/` for that reason: the caller is a client component and this reads
 * nothing but what it is handed.
 */
export function currentScreenName(
  selection: BuilderSelection | undefined,
  steps: readonly DraftStep[],
): string {
  if (selection === undefined || selection.kind === "form") return t("forms.tab.builder");
  const step = steps.find((candidate) => candidate.stepId === selection.stepId);
  if (step === undefined) return t("forms.tab.builder");
  // A GROUP PANEL IS NAMED FOR THE GROUP, not for the step it sits in (task 074). The rail
  // nests the group under its step, so a crumb reading the step's title would name the row
  // above the one marked current - the exact defect this function exists to prevent, one level
  // deeper. A group the draft no longer has falls through to its step, which is where the
  // builder's own selection handler sends the reader.
  if (selection.kind === "group") {
    const group = step.items.find(
      (item) => "groupId" in item && item.groupId === selection.groupId,
    );
    if (group !== undefined && "label" in group) {
      const label = textOf(group.label);
      return label === "" ? t("forms.group.untitled") : label;
    }
  }
  const title = textOf(step.title);
  return title === "" ? t("forms.steps.untitled") : title;
}
